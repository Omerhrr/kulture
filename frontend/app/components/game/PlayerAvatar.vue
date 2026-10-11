<script setup lang="ts">
// PlayerAvatar - local movement prediction with server throttled sync,
// AABB collision vs building footprints, and proximity detection.
// Inputs: WASD / arrow keys, the touch joystick (mobile), plus
// click-to-move (kk_move_target from PointerControls). Keys and the
// joystick are camera-relative (up = away from camera). The server still
// validates every interaction distance and clamps the movement speed
// envelope (client is untrusted).

import * as THREE from 'three'
import { collides, clampBounds } from '~/utils/collision'
import { INTERIOR_DROP } from '~/utils/kadunaExtras'

const world = useWorldStore()
const { isDown } = useKeyboard()
const { onBeforeRender } = useLoop()

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const playerFacing = useState<number>('kk_player_facing', () => 0)
const proximity = useState<{ entityId: string; name: string; code: string } | null>(
  'kk_proximity',
  () => null
)
const moveTarget = useMoveTarget()
const orbit = useCamOrbit()
const touchMove = useTouchMove()
const ride = useRide()
const interior = useInterior()

const group = ref()
const targetRing = ref()
const walking = ref(false)
const sprinting = ref(false)
const bobT = ref(0)

const socketSend = useState<(type: string, payload: Record<string, unknown>) => boolean>(
  'kk_socket_send',
  () => () => false
)

// Dev-only debug hook (headless test automation): teleport player + sync server.
// Sets __kk_teleport_at so the position_corrected snap-back is ignored briefly.
if (import.meta.dev) {
  ;(window as any).__kk_teleport = (x: number, z: number) => {
    ;(window as any).__kk_teleport_at = Date.now()
    playerPos.value = [x, 0, z]
    moveTarget.value = null
    socketSend.value('player.move', { position: [x, 0, z], facing: 0 })
  }
  ;(window as any).__kk_pos = () => [+playerPos.value[0].toFixed(2), +playerPos.value[2].toFixed(2)]
  ;(window as any).__kk_collides = (x: number, z: number) => collides(x, z)
}

const WALK_SPEED = 16
const SPRINT_SPEED = 30
const ARRIVE_RADIUS = 0.6
// give up on unreachable targets; the window scales with distance so
// cross-city walks from the map view are not abandoned mid-way
const targetTimeout = (dist: number, speed: number) => (dist / speed) * 1000 + 5000

let targetStartedAt = 0
let targetStartDist = Infinity

let lastProximityCheck = 0
let lastSent = 0
let lastSentKey = ''

onBeforeRender(({ delta }) => {
  const g = group.value
  if (!g) return

  const dt = Math.min(delta || 0.016, 0.1) // clamp long stalls (tab switch)

  // riding: the vehicle drives (RideSystem owns the position); this avatar
  // disappears - the vehicle renders a seated driver in outer view
  if (ride.value.active) {
    g.visible = false
    if (targetRing.value) targetRing.value.visible = false
    return
  }
  g.visible = true
  const floorY = interior.value.inside ? -INTERIOR_DROP : 0

  // camera basis: forward = away from camera, right = screen right
  const yaw = orbit.value.yaw
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  const rx = Math.cos(yaw)
  const rz = -Math.sin(yaw)

  // 1) keyboard intent (camera-relative: W = up the screen)
  let ix = 0
  let iy = 0
  if (isDown('KeyW', 'ArrowUp', 'z', 'w')) iy += 1
  if (isDown('KeyS', 'ArrowDown', 's')) iy -= 1
  if (isDown('KeyA', 'ArrowLeft', 'q', 'a')) ix -= 1
  if (isDown('KeyD', 'ArrowRight', 'd')) ix += 1

  // 2) touch joystick intent (screen-right / screen-up)
  if (touchMove.value.active) {
    ix += touchMove.value.x
    iy += touchMove.value.y
  }

  const len2 = Math.hypot(ix, iy)
  if (len2 > 1) {
    ix /= len2
    iy /= len2
  }
  const keyMoving = ix !== 0 || iy !== 0
  if (keyMoving) moveTarget.value = null // direct input always wins over click-to-move

  // sprint: Shift on desktop, full joystick push on touch
  const mag = Math.hypot(ix, iy)
  const shift = isDown('ShiftLeft', 'ShiftRight')
  sprinting.value = shift || (touchMove.value.active && mag > 0.92)
  const speed = sprinting.value ? SPRINT_SPEED : WALK_SPEED

  // map screen intent onto the world via the camera basis
  const dx = fx * iy + rx * ix
  const dz = fz * iy + rz * ix

  // 3) click-to-move intent
  let tdx = 0
  let tdz = 0
  const target = moveTarget.value
  if (!keyMoving && target) {
    // keep the destination inside the walkable world
    const [txc, tzc] = clampBounds(target.x, target.z)
    const tx = txc - playerPos.value[0]
    const tz = tzc - playerPos.value[2]
    const dist = Math.hypot(tx, tz)
    if (dist <= ARRIVE_RADIUS) {
      moveTarget.value = null
    } else {
      // progress guard: if a target became unreachable (blocked corner,
      // clamp edge), abandon it instead of walking in place forever
      if (targetStartedAt === 0 || dist + 0.5 < targetStartDist) {
        targetStartedAt = performance.now()
        targetStartDist = dist
      } else if (performance.now() - targetStartedAt > targetTimeout(dist, speed)) {
        moveTarget.value = null
        targetStartedAt = 0
        targetStartDist = Infinity
      }
      tdx = tx / dist
      tdz = tz / dist
    }
  }
  if (!moveTarget.value) {
    targetStartedAt = 0
    targetStartDist = Infinity
  }

  const vx = keyMoving ? dx : tdx
  const vz = keyMoving ? dz : tdz
  const moving = vx !== 0 || vz !== 0
  walking.value = moving

  // free the ring marker when idle
  if (targetRing.value) targetRing.value.visible = !!moveTarget.value
  if (moveTarget.value && targetRing.value) {
    targetRing.value.position.set(moveTarget.value.x, 0.06, moveTarget.value.z)
  }

  const stuck = collides(playerPos.value[0], playerPos.value[2])
  if (moving) {
    const len = Math.hypot(vx, vz) || 1
    let nx = playerPos.value[0] + (vx / len) * speed * dt
    let nz = playerPos.value[2] + (vz / len) * speed * dt
    ;[nx, nz] = clampBounds(nx, nz)

    if (stuck) {
      // Spawned or pushed inside a footprint: walking out beats being trapped.
      playerPos.value[0] = nx
      playerPos.value[2] = nz
    } else {
      // axis-separated collision resolution
      if (!collides(nx, playerPos.value[2])) playerPos.value[0] = nx
      if (!collides(playerPos.value[0], nz)) playerPos.value[2] = nz
    }
    playerFacing.value = Math.atan2(vx, vz)
    playerPos.value[1] = 0

    const now = performance.now()
    const px = +playerPos.value[0].toFixed(2)
    const pz = +playerPos.value[2].toFixed(2)
    const sendKey = `${px}:${pz}:${playerFacing.value.toFixed(2)}`
    if (now - lastSent > 110 && sendKey !== lastSentKey) {
      lastSent = now
      lastSentKey = sendKey
      socketSend.value('player.move', {
        position: [playerPos.value[0], 0, playerPos.value[2]],
        facing: playerFacing.value
      })
    }
  }

  // the CharacterAvatar runs the gait cycle; keep the group on the floor
  bobT.value = moving ? bobT.value + dt : 0
  g.position.set(playerPos.value[0], floorY, playerPos.value[2])
  g.rotation.y = playerFacing.value

  // proximity check (~8/s)
  const now2 = performance.now()
  if (now2 - lastProximityCheck > 120) {
    lastProximityCheck = now2
    let best: { entityId: string; name: string; code: string } | null = null
    let bestD = Infinity
    for (const e of world.entities) {
      if (!e.is_active || e.entity_type === 'spawn') continue
      const d = Math.hypot(playerPos.value[0] - e.position[0], playerPos.value[2] - e.position[2])
      const r = Math.max(e.interaction_radius, 5)
      if (d <= r && d < bestD) {
        bestD = d
        best = { entityId: e.id, name: e.name, code: e.code }
      }
    }
    proximity.value = best
  }
})
</script>

<template>
  <TresGroup ref="group" :position="[playerPos[0], 0, playerPos[2]]">
    <CharacterAvatar
      v-if="!ride.active"
      shirt="#2e7d5b"
      trouser="#2b3440"
      :kufi="true"
      :mode="walking ? 'walk' : 'idle'"
      :gait-speed="sprinting ? 12.5 : 9.5"
    />
    <!-- soft shadow blob -->
    <TresMesh :position="[0, 0.02, 0]" :rotation="[-Math.PI / 2, 0, 0]">
      <TresCircleGeometry :args="[0.55, 20]" />
    </TresMesh>
  </TresGroup>

  <!-- click-to-move destination marker -->
  <TresGroup ref="targetRing" :visible="!!moveTarget">
    <TresMesh :rotation="[-Math.PI / 2, 0, 0]" :position="[0, 0.06, 0]">
      <TresRingGeometry :args="[0.42, 0.6, 24]" />
      <TresMeshBasicMaterial color="#e8b84b" transparent :opacity="0.9" />
    </TresMesh>
  </TresGroup>
</template>
