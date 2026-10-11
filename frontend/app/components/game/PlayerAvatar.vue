<script setup lang="ts">
// PlayerAvatar — local movement prediction with server throttled sync,
// AABB collision vs building footprints, and proximity detection.
// The server still validates every interaction distance (client is untrusted).

import * as THREE from 'three'

const world = useWorldStore()
const { isDown } = useKeyboard()
const { onBeforeRender } = useLoop()

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [0, 0, 42])
const playerFacing = useState<number>('kk_player_facing', () => 0)
const proximity = useState<{ entityId: string; name: string; code: string } | null>(
  'kk_proximity',
  () => null
)

const group = ref()
const walking = ref(false)
const bobT = ref(0)

const socketSend = useState<(type: string, payload: Record<string, unknown>) => boolean>(
  'kk_socket_send',
  () => () => false
)

// Dev-only debug hook (headless test automation): teleport player + sync server.
if (import.meta.dev) {
  ;(window as any).__kk_teleport = (x: number, z: number) => {
    playerPos.value = [x, 0, z]
    socketSend.value('player.move', { position: [x, 0, z], facing: 0 })
  }
}
const BUILDINGS = [
  // Building footprints for basic collision (matches WorldScene geometry).
  { x: -20, z: -12, w: 14, d: 10 },   // Musa's store
  { x: 0, z: -20, w: 3.4, d: 3.4 },   // POS kiosk
  { x: -40, z: -36, w: 16, d: 12 },   // AREWA House
  { x: 36, z: 24, w: 4, d: 4 },       // Stonetech monument
  { x: 30, z: -24, w: 22, d: 14 },    // market stalls block
  { x: -5.5, z: 31.5, w: 10, d: 4 }   // keke stop shelter
]

const SPEED = 9.5

function collides(x: number, z: number): boolean {
  for (const b of BUILDINGS) {
    if (
      Math.abs(x - b.x) < b.w / 2 + 0.6 &&
      Math.abs(z - b.z) < b.d / 2 + 0.6
    ) {
      return true
    }
  }
  return false
}

let lastProximityCheck = 0
let lastSent = 0

onBeforeRender(({ delta, elapsed }) => {
  const g = group.value
  if (!g) return

  let dx = 0
  let dz = 0
  if (isDown('KeyW', 'ArrowUp')) dz -= 1
  if (isDown('KeyS', 'ArrowDown')) dz += 1
  if (isDown('KeyA', 'ArrowLeft')) dx -= 1
  if (isDown('KeyD', 'ArrowRight')) dx += 1

  const moving = dx !== 0 || dz !== 0
  walking.value = moving

  if (moving) {
    const len = Math.hypot(dx, dz) || 1
    let nx = playerPos.value[0] + (dx / len) * SPEED * delta
    let nz = playerPos.value[2] + (dz / len) * SPEED * delta
    nx = Math.max(-58, Math.min(58, nx))
    nz = Math.max(-58, Math.min(58, nz))
    // axis-separated collision resolution
    if (!collides(nx, playerPos.value[2])) playerPos.value[0] = nx
    if (!collides(playerPos.value[0], nz)) playerPos.value[2] = nz
    playerFacing.value = Math.atan2(dx, dz)
    playerPos.value[1] = 0

    const now = performance.now()
    if (now - lastSent > 110) {
      lastSent = now
      const pos: [number, number, number] = [playerPos.value[0], 0, playerPos.value[2]]
      socketSend.value('player.move', { position: pos, facing: playerFacing.value })
    }
  }

  // walk bob
  bobT.value = moving ? bobT.value + delta * 11 : 0
  g.position.set(playerPos.value[0], Math.abs(Math.sin(bobT.value)) * 0.08, playerPos.value[2])
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
    <CharacterAvatar shirt="#2e7d5b" trouser="#2b3440" :kufi="true" />
    <!-- soft shadow blob -->
    <TresMesh :position="[0, 0.02, 0]" :rotation="[-Math.PI / 2, 0, 0]">
      <TresCircleGeometry :args="[0.55, 20]" />
    </TresMesh>
  </TresGroup>
</template>
