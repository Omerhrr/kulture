<script setup lang="ts">
// Interiors - every home in the city can be entered.
//
// Walk to a compound gate (or one of the named open houses with an awning
// and a sign) and press E. A furnished home is built on the spot directly
// below the house (same x/z, INTERIOR_DROP down) so the server just sees
// you standing at the house - no teleport. The camera switches to a
// cut-away "doll's house" view: the walls between you and the camera drop
// to a stub so you look down into the rooms like a life sim.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OPEN_HOUSES, INTERIOR_DROP, doorFront, hash01, type OpenHouse } from '~/utils/kadunaExtras'
import { setInteriorWalls, type Box } from '~/utils/collision'
import { makeLabelTexture } from '~/utils/sign'
import { useInterior, useDoorPrompt, useRide, useCamOrbit } from '~/composables/useControlsState'
import { housePlacements, NW, ND } from '~/utils/housing'
import { buildRoom, cutaway, type BuiltRoom, type Hotspot } from '~/utils/interiorRoom'
import { useSimStore, type NeedKey } from '~/stores/sim'
import { usePlayerPose, fireKkEvent, useMoveTarget } from '~/composables/useControlsState'
import { PLAYABLE_POS } from '~/utils/kaduna'

const ride = useRide()
const interior = useInterior()
const doorPrompt = useDoorPrompt()
const orbit = useCamOrbit()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const ctx = useTresContext() as any
const sim = useSimStore()
const pose = usePlayerPose()
const playerFacing = useState<number>('kk_player_facing', () => 0)

// what each appliance does (real seconds, need points)
const ACTS: Record<Hotspot['id'], { label: string; button: string; need: NeedKey; gain: number; dur: number; sit?: boolean; sleep?: boolean }> = {
  fridge: { label: 'Fridge', button: 'Grab a snack', need: 'hunger', gain: 30, dur: 3 },
  cooker: { label: 'Gas cooker', button: 'Cook jollof', need: 'hunger', gain: 70, dur: 7 },
  bed: { label: 'Bed', button: 'Sleep', need: 'energy', gain: 100, dur: 8, sleep: true },
  tv: { label: 'TV', button: 'Watch TV', need: 'fun', gain: 45, dur: 6, sit: true },
  toilet: { label: 'Toilet', button: 'Use the toilet', need: 'bladder', gain: 100, dur: 3 },
  shower: { label: 'Shower', button: 'Take a baff', need: 'hygiene', gain: 100, dur: 5 }
}
let pendingSpot: { spot: Hotspot; wx: number; wz: number; fwx: number; fwz: number } | null = null
let actAt: [number, number] | null = null
let sleptSkips = 0
const moveTarget = useMoveTarget()
const ui = useUiStore()

// ---------------------------------------------------------------- your home
// The family house closest to where you start is yours. "Home" on the dock
// walks you to its gate (the server only accepts real movement) and lets you in.
let homeIdx = -1
let goingHome = false
function homeDoor(): Door | null {
  if (homeIdx < 0) {
    const [sx, sz] = PLAYABLE_POS.spawn_roadside
    let bd = Infinity
    for (const [i, pl] of housePlacements().entries()) {
      if (pl.type === 'shops' || pl.type === 'open') continue
      const d = Math.hypot(pl.x - sx, pl.z - sz)
      if (d < bd) (bd = d), (homeIdx = i)
    }
  }
  const d = doorForPlacement(homeIdx)
  if (d) d.house.name = 'Your home'
  return d
}
function goHome() {
  if (interior.value.inside) {
    ui.showToast(active?.door.house.name === 'Your home' ? "You're home. Use the fridge, bed or shower." : 'Step out first, then tap Home.', 'info')
    return
  }
  const d = homeDoor()
  if (!d) return
  const [fx, fz] = doorFront(d.house)
  const dist = Math.hypot(playerPos.value[0] - fx, playerPos.value[2] - fz)
  if (dist < 2.2) return enter(d)
  goingHome = true
  moveTarget.value = { x: fx + d.house.nx * 0.6, z: fz + d.house.nz * 0.6 }
  ui.showToast(`Walking home · ${Math.round(dist)} m`, 'info')
}

const root = new THREE.Group()

// ---------------------------------------------------------------- doors
interface Door {
  /** the house as an axis-aligned room footprint (OpenHouse convention) */
  house: OpenHouse
  seed: number
  named: boolean
}

/** Doorway dressing for the named open houses (awning, open door, mat). */
function buildDoorway(h: OpenHouse): THREE.BufferGeometry {
  const parts: Array<[string, THREE.BufferGeometry]> = []
  const off = (h.nz !== 0 ? h.d / 2 : h.w / 2) + 0.02
  const leaf = new THREE.BoxGeometry(1.0, 2.15, 0.07).translate(1.25, 0, 0.55).rotateY(-1.15).translate(0, 1.08, off)
  parts.push(['#4a3524', leaf])
  parts.push(['#3a2a1a', new THREE.BoxGeometry(0.12, 2.3, 0.14).translate(-0.95, 1.15, off)])
  parts.push(['#3a2a1a', new THREE.BoxGeometry(0.12, 2.3, 0.14).translate(0.95, 1.15, off)])
  parts.push(['#8a6a4a', new THREE.BoxGeometry(1.4, 0.05, 0.8).translate(0, 0.03, off + 0.7)])
  parts.push(['#c94a3a', new THREE.BoxGeometry(2.6, 0.1, 1.3).translate(0, 2.55, off + 0.5)])
  parts.push(['#6b4a2f', new THREE.CylinderGeometry(0.06, 0.07, 2.5, 8).translate(-1.15, 1.25, off + 0.95)])
  parts.push(['#6b4a2f', new THREE.CylinderGeometry(0.06, 0.07, 2.5, 8).translate(1.15, 1.25, off + 0.95)])
  const geos = parts.map(([hex, g]) => {
    const gg = g.toNonIndexed()
    gg.deleteAttribute('uv')
    const c = new THREE.Color(hex)
    const arr = new Float32Array(gg.attributes.position.count * 3)
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = c.r
      arr[i + 1] = c.g
      arr[i + 2] = c.b
    }
    gg.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return gg
  })
  return mergeGeometries(geos, false) ?? new THREE.BufferGeometry()
}

const named: Door[] = []
const signs = ref<Array<{ tex: THREE.CanvasTexture; x: number; y: number; z: number }>>([])
const doorGrid = new Map<string, Array<[number, number, number]>>()

onMounted(() => {
  for (const h of OPEN_HOUSES) {
    named.push({ house: h, seed: hash01(h.x, h.z, 61) * 1000, named: true })
    const door = new THREE.Mesh(buildDoorway(h), new THREE.MeshLambertMaterial({ vertexColors: true }))
    door.castShadow = true
    const holder = new THREE.Group()
    holder.add(door)
    holder.position.set(h.x + h.nx * (h.nz !== 0 ? h.w / 2 : h.d / 2), 0, h.z + h.nz * (h.nz !== 0 ? h.d / 2 : h.w / 2))
    holder.rotation.y = Math.atan2(h.nx, h.nz)
    root.add(holder)
    const [fx, fz] = doorFront(h)
    signs.value.push({ tex: makeLabelTexture(h.name.toUpperCase(), '#ffe9a8'), x: fx + h.nx * 0.6, y: 3.4, z: fz + h.nz * 0.6 })
  }
  // gate points of every other home
  for (const [i, pl] of housePlacements().entries()) {
    if (pl.type === 'shops' || pl.type === 'open') continue
    const depth = pl.sz * ND
    const fx = pl.x + Math.sin(pl.yaw) * (depth / 2 + 1.0)
    const fz = pl.z + Math.cos(pl.yaw) * (depth / 2 + 1.0)
    const k = `${Math.floor(fx / 16)},${Math.floor(fz / 16)}`
    let a = doorGrid.get(k)
    if (!a) doorGrid.set(k, (a = []))
    a.push([fx, fz, i])
  }
  homeDoor()
})

function nearestHouseDoor(px: number, pz: number, r: number): number {
  const cx = Math.floor(px / 16)
  const cz = Math.floor(pz / 16)
  let best = -1
  let bestD = r
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const [x, z, idx] of doorGrid.get(`${cx + i},${cz + j}`) ?? []) {
        const d = Math.hypot(x - px, z - pz)
        if (d < bestD) {
          bestD = d
          best = idx
        }
      }
    }
  }
  return best
}

/** A generic home as an axis-aligned room whose door sits on the gate line. */
function doorForPlacement(idx: number): Door | null {
  const pl = housePlacements()[idx]
  if (!pl) return null
  const q = Math.round(pl.yaw / (Math.PI / 2))
  const nx = Math.round(Math.sin(q * (Math.PI / 2)))
  const nz = Math.round(Math.cos(q * (Math.PI / 2)))
  const along = Math.max(10.5, Math.min(14, pl.sx * NW * 0.9))
  const deep = Math.max(9.5, Math.min(12.5, pl.sz * ND * 0.9))
  const w = nz !== 0 ? along : deep
  const d = nz !== 0 ? deep : along
  const depth = pl.sz * ND
  const gx = pl.x + Math.sin(pl.yaw) * (depth / 2)
  const gz = pl.z + Math.cos(pl.yaw) * (depth / 2)
  const hx = gx - nx * (nz !== 0 ? d / 2 : w / 2)
  const hz = gz - nz * (nz !== 0 ? d / 2 : w / 2)
  return { house: { x: hx, z: hz, w, d, rot: 0, nx, nz, name: 'Family Home' }, seed: hash01(pl.x, pl.z, 61) * 1000, named: false }
}

// ---------------------------------------------------------------- active room
let active: { door: Door; room: BuiltRoom; holder: THREE.Group; rot: number; W: number; D: number } | null = null
let pending: Door | null = null

function roomColliders(door: Door, room: BuiltRoom, rot: number): Box[] {
  const cos = Math.round(Math.cos(rot))
  const sin = Math.round(Math.sin(rot))
  return room.colliders.map((b) => {
    const wx = b.x * cos + b.z * sin
    const wz = -b.x * sin + b.z * cos
    const turned = Math.abs(cos) === 0
    return { x: door.house.x + wx, z: door.house.z + wz, w: turned ? b.d : b.w, d: turned ? b.w : b.d }
  })
}

function enter(door: Door) {
  const h = door.house
  const rot = Math.atan2(h.nx, h.nz)
  const W = h.nz !== 0 ? h.w : h.d
  const D = h.nz !== 0 ? h.d : h.w
  const room = buildRoom(W, D, door.seed)
  const holder = new THREE.Group()
  holder.add(room.group)
  holder.position.set(h.x, -INTERIOR_DROP, h.z)
  holder.rotation.y = rot
  root.add(holder)
  active = { door, room, holder, rot, W, D }
  setInteriorWalls(roomColliders(door, room, rot))
  interior.value = { inside: true, name: h.name }
  doorPrompt.value = null
  // step just inside the front door, facing into the living room
  const lz = D / 2 - 1.1
  playerPos.value = [h.x + lz * Math.sin(rot), 0, h.z + lz * Math.cos(rot)]
  orbit.value.yaw = rot + 0.55
}

/** local room coords -> world (room is rotated by `rot` about the house centre) */
function toWorld(lx: number, lz: number): [number, number] {
  const a = active!
  const c = Math.cos(a.rot)
  const sn = Math.sin(a.rot)
  const h = a.door.house
  return [h.x + lx * c + lz * sn, h.z - lx * sn + lz * c]
}

function startUse() {
  if (!pendingSpot) return
  const { spot, wx, wz, fwx, fwz } = pendingSpot
  const a = ACTS[spot.id]
  let gain = a.gain
  if (a.need === 'hunger' && sim.traits.includes('foodie')) gain *= 1.25
  sim.activity = { id: spot.id, label: a.button, need: a.need, gain, dur: a.dur, t: 0 }
  playerPos.value = [wx, playerPos.value[1], wz]
  playerFacing.value = Math.atan2(fwx - wx, fwz - wz)
  actAt = [wx, wz]
  pose.value = a.sit ? 'sit' : 'idle'
  sleptSkips = 0
  doorPrompt.value = null
}
function endUse() {
  sim.activity = null
  pose.value = null
  actAt = null
  sim.save()
}

function exit() {
  if (sim.activity) endUse()
  if (!active) return
  const h = active.door.house
  setInteriorWalls(null)
  interior.value = { inside: false, name: '' }
  doorPrompt.value = null
  root.remove(active.holder)
  active.room.dispose()
  active = null
  const [fx, fz] = doorFront(h)
  playerPos.value = [fx + h.nx * 0.8, 0, fz + h.nz * 0.8]
}

// ---------------------------------------------------------------- loop
let scanTimer = 0
const camLocal = new THREE.Vector3()
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  // doll's house cut-away: drop the walls facing the camera
  if (active) {
    const cam = ctx.camera?.activeCamera?.value as THREE.Camera | undefined
    if (cam) {
      camLocal.copy(cam.position)
      active.holder.worldToLocal(camLocal)
      cutaway(active.room, camLocal.x, camLocal.z)
    }
  }
  // furniture in use: refill the need over the action's duration
  const act = sim.activity
  if (act && active) {
    const dt = Math.min(delta || 0.016, 0.25)
    act.t += dt
    sim.bump(act.need, (act.gain / act.dur) * dt)
    // sleeping passes the night: 6 in-game hours over the action
    if (ACTS[act.id as Hotspot['id']]?.sleep && sleptSkips < 3 && act.t > ((sleptSkips + 1) * act.dur) / 4) {
      sleptSkips++
      fireKkEvent('kk-time-skip')
    }
    const moved = actAt && Math.hypot(playerPos.value[0] - actAt[0], playerPos.value[2] - actAt[1]) > 0.35
    if (act.t >= act.dur || moved) endUse()
  }
  scanTimer += delta || 0
  if (scanTimer < 0.18) return
  scanTimer = 0
  if (ride.value.active) {
    doorPrompt.value = null
    return
  }
  const px = playerPos.value[0]
  const pz = playerPos.value[2]
  if (goingHome && !interior.value.inside) {
    const d = homeDoor()!
    const [fx, fz] = doorFront(d.house)
    if (Math.hypot(px - fx, pz - fz) < 2.2) {
      goingHome = false
      moveTarget.value = null
      enter(d)
      return
    }
    if (!moveTarget.value) goingHome = false // you took over or got stuck
  }
  if (!interior.value.inside) {
    for (const d of named) {
      const [fx, fz] = doorFront(d.house)
      if (Math.hypot(px - fx, pz - fz) < 1.7) {
        pending = d
        doorPrompt.value = { label: `Enter ${d.house.name}`, action: 'enter', slot: 0 }
        return
      }
    }
    const idx = nearestHouseDoor(px, pz, 1.8)
    if (idx >= 0) {
      pending = idx === homeIdx ? homeDoor() : doorForPlacement(idx)
      doorPrompt.value = { label: idx === homeIdx ? 'Your home' : 'Enter this home', action: 'enter', slot: 0, button: idx === homeIdx ? 'Go inside' : undefined }
      return
    }
    pending = null
    doorPrompt.value = null
  } else if (active) {
    const h = active.door.house
    // the exit is the front door (inside, just behind the threshold)
    const lz = active.D / 2 - 0.6
    const ex = h.x + lz * Math.sin(active.rot)
    const ez = h.z + lz * Math.cos(active.rot)
    if (Math.hypot(px - ex, pz - ez) < 1.6) {
      doorPrompt.value = { label: 'Exit to the street', action: 'exit', slot: 0 }
      return
    }
    if (sim.activity) {
      doorPrompt.value = null
      return
    }
    // appliances: fridge, cooker, bed, TV, toilet, shower
    let best: typeof pendingSpot = null
    let bd = 1.25
    for (const spot of active.room.hotspots) {
      const [wx, wz] = toWorld(spot.x, spot.z)
      const d = Math.hypot(px - wx, pz - wz)
      if (d < bd) {
        const [fwx, fwz] = toWorld(spot.fx, spot.fz)
        bd = d
        best = { spot, wx, wz, fwx, fwz }
      }
    }
    pendingSpot = best
    doorPrompt.value = best ? { label: ACTS[best.spot.id].label, action: 'use', slot: 0, button: ACTS[best.spot.id].button } : null
  }
})

function onDoorUse() {
  const p = doorPrompt.value
  if (!p) return
  if (p.action === 'enter' && pending) enter(pending)
  else if (p.action === 'exit') exit()
  else if (p.action === 'use') startUse()
}

onMounted(() => {
  window.addEventListener('kk-door-use', onDoorUse)
  window.addEventListener('kk-go-home', goHome)
  if (import.meta.dev) {
    ;(window as any).__kk_doors = () => named.map((d) => ({ name: d.house.name, door: doorFront(d.house).map((v) => +v.toFixed(1)) }))
    ;(window as any).__kk_interior = () => ({ ...interior.value, prompt: doorPrompt.value, activity: sim.activity })
    ;(window as any).__kk_hotspots = () => (active ? active.room.hotspots.map((h) => ({ id: h.id, at: toWorld(h.x, h.z) })) : [])
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-door-use', onDoorUse)
  window.removeEventListener('kk-go-home', goHome)
  if (active) active.room.dispose()
})
</script>

<template>
  <TresGroup>
    <primitive :object="root" />
    <TresSprite v-for="(s, i) in signs" :key="'sig' + i" :position="[s.x, s.y, s.z]" :scale="[9, 1.7, 1]">
      <TresSpriteMaterial :map="s.tex" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
