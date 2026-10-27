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
import { buildRoom, cutaway, type BuiltRoom, type Hotspot, type LocalBox } from '~/utils/interiorRoom'
import { FLOOR_H, stairOf, stairT, onStairFootprint, stairLowerColliders, stairCorridor, buildStairs, buildUpperFloor, levelsFor, type Stair } from '~/utils/interiorFloors'
import { interiorLevel } from '~/utils/interiorLevel'
import { useSimStore, type NeedKey } from '~/stores/sim'
import { usePlayerPose, fireKkEvent, useMoveTarget } from '~/composables/useControlsState'
import { PLAYABLE_POS } from '~/utils/kaduna'
import { localName } from '~/utils/regions'
import { nearestSeat } from '~/utils/seats'
import { ITEMS, rotLocal, starterLayout, homeLayout, tintItem } from '~/utils/furniture'
import { useHomeStore } from '~/stores/home'
import { buildVenue, VENUE_INFO, VENUE_CYCLE, type VenueType, type VenueActor, type VenueAction, type VenueSpot } from '~/utils/venues'
import { lookFor } from '~/utils/wardrobe'

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
type Pose = string
const ACTS: Record<string, { label: string; button: string; need: NeedKey; gain: number; dur: number; pose?: Pose; skips?: number; stay?: boolean; service?: string }> = {
  fridge: { label: 'Fridge', button: 'Grab a snack', need: 'hunger', gain: 30, dur: 3 },
  cooker: { label: 'Gas cooker', button: 'Cook jollof', need: 'hunger', gain: 70, dur: 7 },
  bed: { label: 'Bed', button: 'Sleep', need: 'energy', gain: 100, dur: 8, pose: 'sleep', skips: 3 },
  tv: { label: 'Sofa · TV', button: 'Sit and watch TV', need: 'fun', gain: 45, dur: 6, pose: 'sit', stay: true },
  sofa: { label: 'Sofa cushions', button: 'Nap on the sofa', need: 'energy', gain: 40, dur: 6, pose: 'sleep', skips: 1 },
  dining: { label: 'Dining table', button: 'Sit and eat', need: 'hunger', gain: 45, dur: 6, pose: 'eat', stay: true },
  toilet: { label: 'Toilet', button: 'Use the toilet', need: 'bladder', gain: 100, dur: 3 },
  shower: { label: 'Shower', button: 'Take a baff', need: 'hygiene', gain: 100, dur: 5 },
  chair: { label: 'Chair', button: 'Sit down', need: 'fun', gain: 12, dur: 6, pose: 'sit', stay: true },
  street: { label: 'Seat', button: 'Sit down', need: 'fun', gain: 12, dur: 6, pose: 'sit', stay: true }
}
/** venue spots carry their own action; homes use the ACTS table */
const venueActs: Record<string, VenueAction> = {}
const actOf = (id: string) => venueActs[id] ?? ACTS[id]
interface Pending {
  id: string
  wx: number
  wz: number
  fwx: number
  fwz: number
  seat?: { x: number; z: number; h: number; yaw: number }
  label?: string
}
let pendingSpot: Pending | null = null
let actAt: [number, number] | null = null
let standAt: [number, number] | null = null
let seated = false
const seatH = useState<number>('kk_player_seat', () => 0.45)
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
  /** public place: office, mosque, restaurant ... */
  venue?: VenueType
  /** storeys (duplexes 2, blocks of flats 3) */
  levels?: number
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
  setupVenues()
  const hd = homeDoor()
  if (hd) {
    const [fx, fz] = doorFront(hd.house)
    useState<[number, number] | null>('kk_home_door').value = [fx + hd.house.nx * 0.8, fz + hd.house.nz * 0.8]
    // gate + street-facing direction: your car park sits beside the gate
    useState<{ x: number; z: number; nx: number; nz: number; w: number } | null>('kk_home_front').value = { x: fx, z: fz, nx: hd.house.nx, nz: hd.house.nz, w: hd.house.nz !== 0 ? hd.house.w : hd.house.d }
  }
})

// ---------------------------------------------------------------- venues
// Shop-front plots along the main roads become the city's public places:
// the nearest ones to where you start cycle through every type so there is
// one of each close by, the rest repeat further out.
const venueDoors: Door[] = []
const venueByPlacement = new Map<number, number>()
const landmarks = new THREE.Group()
function setupVenues() {
  const [sx, sz] = PLAYABLE_POS.spawn_roadside
  const shops = housePlacements()
    .map((pl, i) => ({ pl, i, d: Math.hypot(pl.x - sx, pl.z - sz) }))
    .filter((o) => o.pl.type === 'shops')
    .sort((a, b) => a.d - b.d)
    .slice(0, 40)
  shops.forEach(({ pl, i }, k) => {
    const type = VENUE_CYCLE[k % VENUE_CYCLE.length]
    const info = VENUE_INFO[type]
    const q = Math.round(pl.yaw / (Math.PI / 2))
    const nx = Math.round(Math.sin(q * (Math.PI / 2)))
    const nz = Math.round(Math.cos(q * (Math.PI / 2)))
    const [VW, VD] = info.size
    const depth = pl.sz * ND
    const gx = pl.x + Math.sin(pl.yaw) * (depth / 2 + 0.6)
    const gz = pl.z + Math.cos(pl.yaw) * (depth / 2 + 0.6)
    const w = nz !== 0 ? VW : VD
    const d = nz !== 0 ? VD : VW
    const hx = gx - nx * (nz !== 0 ? d / 2 : w / 2)
    const hz = gz - nz * (nz !== 0 ? d / 2 : w / 2)
    const name = localName(info.names[Math.floor(hash01(pl.x, pl.z, 17) * info.names.length) % info.names.length]!)
    const door: Door = { house: { x: hx, z: hz, w, d, rot: 0, nx, nz, name }, seed: hash01(pl.x, pl.z, 63) * 1000, named: true, venue: type }
    venueByPlacement.set(i, venueDoors.length)
    venueDoors.push(door)
    const [fx, fz] = doorFront(door.house)
    signs.value.push({ tex: makeLabelTexture(`${info.icon} ${name.toUpperCase()}`, type === 'mosque' ? '#bff0c8' : type === 'church' ? '#e8e0ff' : '#ffe9a8'), x: fx + nx * 0.4, y: 4.2, z: fz + nz * 0.4 })
    // landmarks so you can spot them from the road
    const side = nz !== 0 ? [1, 0] : [0, 1]
    const tx = fx + side[0] * 4.5 - nx * 1.5
    const tz = fz + side[1] * 4.5 - nz * 1.5
    if (type === 'mosque') {
      const m = new THREE.Group()
      const white = new THREE.MeshLambertMaterial({ color: '#f2efe6' })
      const green = new THREE.MeshLambertMaterial({ color: '#1f7a4a' })
      m.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 16, 12).translate(0, 8, 0), white))
      m.add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.4, 12).translate(0, 12.5, 0), white))
      m.add(new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 16, 0), green))
      m.add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.2, 8).translate(0, 17.4, 0), new THREE.MeshLambertMaterial({ color: '#d8b84a' })))
      m.position.set(tx, 0, tz)
      landmarks.add(m)
    } else if (type === 'church') {
      const m = new THREE.Group()
      const wall = new THREE.MeshLambertMaterial({ color: '#efe8d6' })
      m.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 13, 2.4).translate(0, 6.5, 0), wall))
      m.add(new THREE.Mesh(new THREE.ConeGeometry(1.9, 4, 4).rotateY(Math.PI / 4).translate(0, 15, 0), new THREE.MeshLambertMaterial({ color: '#8a3a2a' })))
      const brown = new THREE.MeshLambertMaterial({ color: '#d8b84a' })
      m.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2).translate(0, 18, 0), brown))
      m.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.2).translate(0, 18.4, 0), brown))
      m.position.set(tx, 0, tz)
      landmarks.add(m)
    }
  })
  root.add(landmarks)
}

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
  return { house: { x: hx, z: hz, w, d, rot: 0, nx, nz, name: 'Family Home' }, seed: hash01(pl.x, pl.z, 61) * 1000, named: false, levels: levelsFor(pl.type) }
}

// ---------------------------------------------------------------- active room
let active: { door: Door; room: BuiltRoom; holder: THREE.Group; rot: number; W: number; D: number; home: boolean; vspots: VenueSpot[]; floors: BuiltRoom[]; stairs: Stair[]; extra: LocalBox[][] } | null = null
// the people inside a public place (rendered by the template)
const actors = ref<Array<VenueActor & { look: ReturnType<typeof lookFor> }>>([])
const actorFrame = ref<{ x: number; y: number; z: number; rot: number } | null>(null)

// ---------------------------------------------------------------- your furniture
const home = useHomeStore()
const furnGroup = new THREE.Group()
const objs = new Map<string, { obj: THREE.Group; sku: string }>()
let furnColliders: Array<{ x: number; z: number; w: number; d: number }> = []
let furnSpots: Hotspot[] = []
// someone else's home: furniture from the house seed (look, don't touch)
const visitGroup = new THREE.Group()
let visitColliders: Array<{ x: number; z: number; w: number; d: number }> = []
let visitSpots: Hotspot[] = []
function furnishVisit(W: number, D: number, seed: number) {
  clearVisit()
  const { items, tints } = homeLayout(W, D, seed)
  for (const it of items) {
    const def = ITEMS[it.sku]
    if (!def) continue
    const obj = def.build()
    tintItem(obj, tints)
    obj.position.set(it.x, 0, it.z)
    obj.rotation.y = (it.rot * Math.PI) / 2
    obj.traverse((c) => (c.userData.sku = it.sku))
    visitGroup.add(obj)
    const odd = it.rot % 2 === 1
    if (def.solid) visitColliders.push({ x: it.x, z: it.z, w: (odd ? def.d : def.w) * 0.92, d: (odd ? def.w : def.d) * 0.92 })
    for (const sp of def.spots ?? []) {
      const [ax, az] = rotLocal(sp.x, sp.z, it.rot)
      const spot: Hotspot = { id: sp.id, x: it.x + ax, z: it.z + az, fx: it.x, fz: it.z }
      if (sp.seat) {
        const [sx2, sz2] = rotLocal(sp.seat.x, sp.seat.z, it.rot)
        spot.seat = { x: it.x + sx2, z: it.z + sz2, h: sp.seat.h, yaw: sp.seat.yaw + (it.rot * Math.PI) / 2 }
      }
      visitSpots.push(spot)
    }
  }
}
function clearVisit() {
  for (const o of [...visitGroup.children]) {
    visitGroup.remove(o)
    o.traverse((c) => (c as THREE.Mesh).geometry?.dispose())
  }
  visitColliders = []
  visitSpots = []
}
const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0x2f9e6e)
selBox.visible = false
root.add(selBox) // BoxHelper works in world space

function allSpots(): Array<Hotspot | VenueSpot> {
  if (!active) return []
  if (interiorLevel.stair >= 0) return []
  if (interiorLevel.level > 0) return active.floors[interiorLevel.level]?.hotspots ?? []
  return [...active.room.hotspots, ...furnSpots, ...visitSpots, ...active.vspots]
}
/** furniture never blocks the staircase (it was placed before stairs existed) */
function clearOfStairs(b: LocalBox): boolean {
  const s = active?.stairs[0]
  if (!s) return true
  const x0 = Math.min(s.xb, s.xt) - 0.3
  const x1 = Math.max(s.xb, s.xt) + 0.3
  return !(Math.abs(b.z - s.zs) < b.d / 2 + s.sw / 2 + 0.3 && b.x + b.w / 2 > x0 && b.x - b.w / 2 < x1)
}
function refreshColliders() {
  if (!active) return
  const L = interiorLevel.level
  let boxes: LocalBox[]
  if (interiorLevel.stair >= 0) boxes = stairCorridor(active.stairs[interiorLevel.stair]!, active.D)
  else if (L > 0) boxes = [...active.floors[L]!.colliders, ...(active.extra[L] ?? [])]
  else boxes = [...active.room.colliders, ...(active.extra[0] ?? []), ...[...furnColliders, ...visitColliders].filter(clearOfStairs)]
  setInteriorWalls(roomColliders(active.door, { ...active.room, colliders: boxes } as BuiltRoom, active.rot))
}
/** world -> room-local */
function toLocal(x: number, z: number): [number, number] {
  const a = active!
  const c = Math.cos(a.rot)
  const sn = Math.sin(a.rot)
  const dx = x - a.door.house.x
  const dz = z - a.door.house.z
  return [dx * c - dz * sn, dx * sn + dz * c]
}
/** Every frame: climb the stairs, change floor, show the floors below you. */
function updateLevel() {
  if (!active || active.floors.length < 2) return
  const [lx, lz] = toLocal(playerPos.value[0], playerPos.value[2])
  const L = interiorLevel.level
  const before = `${interiorLevel.level}:${interiorLevel.stair}`
  if (interiorLevel.stair < 0) {
    // step onto the flight going up from this floor, or down into the well
    const up = active.stairs[L]
    const down = L > 0 ? active.stairs[L - 1] : undefined
    if (up && onStairFootprint(up, lx, lz)) interiorLevel.stair = L
    else if (down && onStairFootprint(down, lx, lz)) interiorLevel.stair = L - 1
  }
  if (interiorLevel.stair >= 0) {
    const s = active.stairs[interiorLevel.stair]!
    const t = Math.max(0, Math.min(1, stairT(s, lx)))
    interiorLevel.y = (s.level + t) * FLOOR_H
    if (!onStairFootprint(s, lx, lz)) {
      // stepped off: top end = the floor above, bottom end = the floor below
      interiorLevel.level = t > 0.5 ? s.level + 1 : s.level
      interiorLevel.stair = -1
      interiorLevel.y = interiorLevel.level * FLOOR_H
    }
  } else interiorLevel.y = interiorLevel.level * FLOOR_H
  // the floors above you are hidden so the doll's-house view looks down into yours
  const showUpTo = interiorLevel.stair >= 0 ? interiorLevel.stair + (stairT(active.stairs[interiorLevel.stair]!, lx) > 0.75 ? 1 : 0) : interiorLevel.level
  active.floors.forEach((f, i) => (f.group.visible = i <= showUpTo))
  if (`${interiorLevel.level}:${interiorLevel.stair}` !== before) {
    refreshColliders()
    if (interiorLevel.stair < 0) ui.showToast(interiorLevel.level === 0 ? 'Ground floor' : `${['', 'First', 'Second', 'Third'][interiorLevel.level]} floor`, 'info')
  }
}
function syncFurniture() {
  if (!active?.home) return
  const seen = new Set<string>()
  furnColliders = []
  furnSpots = []
  for (const it of home.items) {
    const def = ITEMS[it.sku]
    if (!def) continue
    seen.add(it.uid)
    let o = objs.get(it.uid)
    if (!o) {
      const obj = def.build()
      obj.userData.uid = it.uid
      obj.traverse((c) => (c.userData.uid = it.uid))
      furnGroup.add(obj)
      o = { obj, sku: it.sku }
      objs.set(it.uid, o)
    }
    o.obj.position.set(it.x, 0, it.z)
    o.obj.rotation.y = (it.rot * Math.PI) / 2
    const odd = it.rot % 2 === 1
    if (def.solid) furnColliders.push({ x: it.x, z: it.z, w: (odd ? def.d : def.w) * 0.92, d: (odd ? def.w : def.d) * 0.92 })
    for (const sp of def.spots ?? []) {
      const [ax, az] = rotLocal(sp.x, sp.z, it.rot)
      const spot: Hotspot = { id: sp.id, x: it.x + ax, z: it.z + az, fx: it.x, fz: it.z }
      if (sp.seat) {
        const [sx2, sz2] = rotLocal(sp.seat.x, sp.seat.z, it.rot)
        spot.seat = { x: it.x + sx2, z: it.z + sz2, h: sp.seat.h, yaw: sp.seat.yaw + (it.rot * Math.PI) / 2 }
      }
      furnSpots.push(spot)
    }
  }
  for (const [uid, o] of objs) {
    if (seen.has(uid)) continue
    furnGroup.remove(o.obj)
    o.obj.traverse((c) => (c as THREE.Mesh).geometry?.dispose())
    objs.delete(uid)
  }
  refreshColliders()
  updateSelBox()
}
function updateSelBox() {
  const o = home.selected ? objs.get(home.selected) : null
  if (o && home.build) {
    selBox.setFromObject(o.obj)
    selBox.visible = true
  } else selBox.visible = false
}
watch(() => home.version, syncFurniture)
watch(() => [home.selected, home.build], updateSelBox)
watch(
  () => home.build,
  (b) => {
    if (!b) home.selected = null
  }
)

// build mode: tap a piece to select it, drag it across the floor
const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), INTERIOR_DROP)
const hitPt = new THREE.Vector3()
let dragging: string | null = null
let dragOff: [number, number] = [0, 0]
function pointerRay(e: PointerEvent): boolean {
  const cam = ctx.camera?.activeCamera?.value as THREE.Camera | undefined
  const el = (ctx.renderer?.instance ?? ctx.renderer?.value)?.domElement as HTMLElement | undefined
  if (!cam || !el) return false
  const r = el.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  ray.setFromCamera(ndc, cam)
  return true
}
function floorLocal(): [number, number] | null {
  if (!active || !ray.ray.intersectPlane(floorPlane, hitPt)) return null
  const v = active.holder.worldToLocal(hitPt.clone())
  return [v.x, v.z]
}
// tap any piece of furniture: see what it is; in your own home it also
// opens build mode with that piece selected (move / rotate / sell)
function onInspect(e: PointerEvent) {
  // furniture lives on the ground floor: upstairs, taps go to the floor you're on
  if (interiorLevel.level > 0 || interiorLevel.stair >= 0) return
  if (home.build || !active || (e.target as HTMLElement)?.tagName !== 'CANVAS' || !pointerRay(e)) return
  const targets = active.home ? furnGroup.children : visitGroup.children
  const hit = ray.intersectObjects(targets, true).find((h) => h.object.userData.uid || h.object.userData.sku)
  if (!hit) return
  if (active.home) {
    const uid = hit.object.userData.uid as string
    const it = home.items.find((i) => i.uid === uid)
    if (!it) return
    e.stopPropagation()
    home.build = true
    home.selected = uid
    ui.showToast(`${ITEMS[it.sku]?.name ?? it.sku} · drag to move, Rotate or Sell below`, 'info')
  } else {
    const sku = hit.object.userData.sku as string
    ui.showToast(`${ITEMS[sku]?.name ?? sku} · not yours to move`, 'info')
  }
}
function onBuildDown(e: PointerEvent) {
  if (interiorLevel.level > 0 || interiorLevel.stair >= 0) return
  if (!home.build || !active?.home || (e.target as HTMLElement)?.tagName !== 'CANVAS' || !pointerRay(e)) return
  const hits = ray.intersectObjects(furnGroup.children, true)
  const uid = hits.find((h) => h.object.userData.uid)?.object.userData.uid as string | undefined
  if (!uid) {
    home.selected = null
    return
  }
  e.stopPropagation()
  e.preventDefault()
  home.selected = uid
  const it = home.items.find((i) => i.uid === uid)
  const p = floorLocal()
  if (it && p) {
    dragging = uid
    dragOff = [it.x - p[0], it.z - p[1]]
  }
}
function onBuildMove(e: PointerEvent) {
  if (!dragging || !active || !pointerRay(e)) return
  e.stopPropagation()
  const p = floorLocal()
  const it = home.items.find((i) => i.uid === dragging)
  if (!p || !it) return
  const snap = (v: number) => Math.round(v / 0.05) * 0.05
  it.x = Math.max(-active.W / 2 + 0.3, Math.min(active.W / 2 - 0.3, snap(p[0] + dragOff[0])))
  it.z = Math.max(-active.D / 2 + 0.3, Math.min(active.D / 2 - 0.3, snap(p[1] + dragOff[1])))
  const o = objs.get(it.uid)
  o?.obj.position.set(it.x, 0, it.z)
  updateSelBox()
}
function onBuildUp() {
  if (!dragging) return
  const it = home.items.find((i) => i.uid === dragging)
  dragging = null
  if (it) home.move(it.uid, it.x, it.z, it.rot).catch(() => {})
}
onMounted(() => {
  window.addEventListener('pointerdown', onBuildDown, true)
  window.addEventListener('pointerdown', onInspect, true)
  window.addEventListener('pointermove', onBuildMove, true)
  window.addEventListener('pointerup', onBuildUp, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onBuildDown, true)
  window.removeEventListener('pointerdown', onInspect, true)
  window.removeEventListener('pointermove', onBuildMove, true)
  window.removeEventListener('pointerup', onBuildUp, true)
})
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
  const isHome = h.name === 'Your home'
  const venue = door.venue ? buildVenue(door.venue, door.seed) : null
  const room = venue ? venue.room : buildRoom(W, D, door.seed, { customFurniture: true })
  const holder = new THREE.Group()
  holder.add(room.group)
  if (isHome) {
    holder.add(furnGroup)
  } else if (!venue) {
    furnishVisit(W, D, door.seed)
    holder.add(visitGroup)
  }
  holder.position.set(h.x, -INTERIOR_DROP, h.z)
  holder.rotation.y = rot
  root.add(holder)
  // upper storeys + the staircases between them
  const levels = venue ? 1 : Math.max(1, Math.min(4, door.levels ?? 1))
  const floors: BuiltRoom[] = [room]
  const stairs: Stair[] = []
  const extra: LocalBox[][] = [[]]
  for (let L = 0; L < levels; L++) {
    if (L > 0) {
      const up = buildUpperFloor(W, D, door.seed, L)
      up.group.position.y = L * FLOOR_H
      holder.add(up.group)
      floors.push(up)
      extra.push([])
    }
    if (L < levels - 1) {
      const s = stairOf(W, D, L)
      stairs.push(s)
      const mesh = buildStairs(s, L % 2 ? '#8a5a3a' : '#a8784a', '#5a3a22')
      // the flight belongs to the floor it leaves (hidden with it)
      floors[L]!.group.add(mesh)
      extra[L]!.push(...stairLowerColliders(W, s))
    }
  }
  interiorLevel.reset()
  interiorLevel.levels = levels
  active = { door, room, holder, rot, W, D, home: isHome, vspots: venue?.spots ?? [], floors, stairs, extra }
  for (const sp of venue?.spots ?? []) venueActs[sp.id] = sp.act
  actors.value = (venue?.actors ?? []).map((a) => {
    const look = lookFor(a.id, !!a.female)
    // uniforms for staff, prayer clothes in the mosque
    if (a.staff === 'chef') Object.assign(look, { top: '#f2f2f0', bottom: '#2b2b2f' })
    else if (a.staff === 'waiter' || a.staff === 'bartender') Object.assign(look, { top: '#1d1f24', bottom: '#1d1f24' })
    else if (a.staff === 'reception' || a.staff === 'cashier' || a.staff === 'porter') Object.assign(look, { top: '#1f2a44', bottom: '#2b3440' })
    else if (a.staff === 'pastor') Object.assign(look, { top: '#2b2b2f', bottom: '#2b2b2f' })
    else if (a.staff === 'choir') Object.assign(look, { top: '#7a2a4a', bottom: '#7a2a4a' })
    if (door.venue === 'mosque') Object.assign(look, { top: ['#efe8d6', '#f2f2f0', '#c9b78e', '#3f6fae'][a.id % 4] })
    return { ...a, look }
  })
  actorFrame.value = { x: h.x, y: -INTERIOR_DROP, z: h.z, rot }
  refreshColliders()
  if (isHome) {
    home
      .load(() => starterLayout(W, D))
      .then(syncFurniture)
      .catch((e: any) => ui.showToast(e.message || 'Could not load your furniture', 'error'))
  }
  interior.value = { inside: true, name: h.name, venue: door.venue, cx: h.x, cz: h.z, rot }
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

const api = useGameApi()
const playerStore = usePlayerStore()
async function startUse() {
  if (!pendingSpot) return
  const sp = pendingSpot
  const a = actOf(sp.id)
  if (!a) return
  if (a.service) {
    // pay first (server prices and balance), then enjoy
    try {
      const r = await api.venueSpend(a.service)
      if (playerStore.profile) playerStore.profile.ksats_balance = r.balance_ksats
      ui.showToast(`Paid ${r.price_ksats.toLocaleString()} ks`, 'success')
    } catch (e: any) {
      ui.showToast(e?.message || 'Payment failed', 'error')
      return
    }
  }
  let gain = a.gain
  if (a.need === 'hunger' && sim.traits.includes('foodie')) gain *= 1.25
  sim.activity = { id: sp.id, label: a.button, need: a.need, gain, dur: a.dur, t: 0 }
  standAt = [sp.wx, sp.wz]
  if (sp.seat) {
    // onto the furniture: body on the seat, facing the way it faces
    playerPos.value = [sp.seat.x, playerPos.value[1], sp.seat.z]
    playerFacing.value = sp.seat.yaw
    seatH.value = sp.seat.h
    seated = true
  } else {
    playerPos.value = [sp.wx, playerPos.value[1], sp.wz]
    playerFacing.value = Math.atan2(sp.fwx - sp.wx, sp.fwz - sp.wz)
  }
  actAt = [playerPos.value[0], playerPos.value[2]]
  pose.value = a.pose ?? 'idle'
  sleptSkips = 0
  doorPrompt.value = null
}
/** activity over; seats you can stay on keep you seated until you move */
function endUse(keepSeat = false) {
  const id = sim.activity?.id as string | undefined
  sim.activity = null
  sim.save()
  if (keepSeat && seated && id && actOf(id)?.stay) {
    pose.value = 'sit'
    return
  }
  standUp()
}
function standUp() {
  sim.activity = null
  if (seated && standAt) playerPos.value = [standAt[0], playerPos.value[1], standAt[1]]
  seated = false
  pose.value = null
  actAt = null
  standAt = null
  seatH.value = 0.45
}
function onStandUp() {
  if (seated || sim.activity) {
    sim.activity = null
    standUp()
  }
}

function exit() {
  if (sim.activity) endUse()
  if (!active) return
  const h = active.door.house
  setInteriorWalls(null)
  interior.value = { inside: false, name: '' }
  doorPrompt.value = null
  root.remove(active.holder)
  for (const f of active.floors) f.dispose()
  interiorLevel.reset()
  if (active.home) {
    for (const o of objs.values()) {
      furnGroup.remove(o.obj)
      o.obj.traverse((c) => (c as THREE.Mesh).geometry?.dispose())
    }
    objs.clear()
    furnColliders = []
    furnSpots = []
    home.build = false
  }
  clearVisit()
  active = null
  actors.value = []
  actorFrame.value = null
  const [fx, fz] = doorFront(h)
  playerPos.value = [fx + h.nx * 0.8, 0, fz + h.nz * 0.8]
}

// ---------------------------------------------------------------- loop
let scanTimer = 0
const camLocal = new THREE.Vector3()
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  updateLevel()
  // doll's house cut-away: drop the walls facing the camera
  if (active) {
    const cam = ctx.camera?.activeCamera?.value as THREE.Camera | undefined
    if (cam) {
      camLocal.copy(cam.position)
      active.holder.worldToLocal(camLocal)
      cutaway(active.floors[interiorLevel.level] ?? active.room, camLocal.x, camLocal.z)
    }
  }
  // furniture in use: refill the need over the action's duration
  const act = sim.activity
  if (act && active) {
    const dt = Math.min(delta || 0.016, 0.25)
    act.t += dt
    sim.bump(act.need, (act.gain / act.dur) * dt)
    // sleeping passes the night (2 in-game hours per skip)
    const def = actOf(act.id as string) as any
    const skips = def?.skips ?? 0
    if (skips && sleptSkips < skips && act.t > ((sleptSkips + 1) * act.dur) / (skips + 1)) {
      sleptSkips++
      fireKkEvent('kk-time-skip')
    }
    const moved = !seated && actAt && Math.hypot(playerPos.value[0] - actAt[0], playerPos.value[2] - actAt[1]) > 0.35
    if (act.t >= act.dur) endUse(true)
    else if (moved) standUp()
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
    for (const d of venueDoors) {
      const [fx, fz] = doorFront(d.house)
      if (Math.abs(px - fx) < 3 && Math.abs(pz - fz) < 3 && Math.hypot(px - fx, pz - fz) < 2.0) {
        pending = d
        doorPrompt.value = { label: `${VENUE_INFO[d.venue!].icon} ${d.house.name}`, action: 'enter', slot: 0, button: `Enter ${VENUE_INFO[d.venue!].label.toLowerCase()}` }
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
    // street seats: kiosk chairs, bus-shelter benches
    if (seated && !sim.activity) {
      doorPrompt.value = { label: 'Stand up', action: 'use', slot: 0, button: 'Stand up' }
      return
    }
    if (sim.activity) {
      doorPrompt.value = null
      return
    }
    const st = nearestSeat(px, pz, 1.2)
    if (st) {
      pendingSpot = { id: 'street', wx: px, wz: pz, fwx: st.x, fwz: st.z, seat: { x: st.x, z: st.z, h: st.h, yaw: st.yaw }, label: st.label }
      doorPrompt.value = { label: st.label, action: 'use', slot: 0, button: 'Sit down' }
      return
    }
    doorPrompt.value = null
  } else if (active) {
    const h = active.door.house
    // the exit is the front door (inside, just behind the threshold)
    const lz = active.D / 2 - 0.6
    const ex = h.x + lz * Math.sin(active.rot)
    const ez = h.z + lz * Math.cos(active.rot)
    if (interiorLevel.level === 0 && interiorLevel.stair < 0 && Math.hypot(px - ex, pz - ez) < 1.6) {
      doorPrompt.value = { label: 'Exit to the street', action: 'exit', slot: 0 }
      return
    }
    if (sim.activity) {
      doorPrompt.value = null
      return
    }
    if (seated) {
      doorPrompt.value = { label: 'Stand up', action: 'use', slot: 0, button: 'Stand up' }
      return
    }
    // appliances + furniture: fridge, cooker, bed, sofa, TV, dining, toilet, shower
    let best: typeof pendingSpot = null
    let bd = 1.25
    for (const spot of allSpots()) {
      const [wx, wz] = toWorld(spot.x, spot.z)
      const d = Math.hypot(px - wx, pz - wz)
      if (d < bd) {
        const [fwx, fwz] = toWorld(spot.fx, spot.fz)
        bd = d
        let seat: Pending['seat']
        if (spot.seat) {
          const [sx, sz] = toWorld(spot.seat.x, spot.seat.z)
          seat = { x: sx, z: sz, h: spot.seat.h, yaw: active.rot + spot.seat.yaw }
        }
        best = { id: spot.id as string, wx, wz, fwx, fwz, seat }
      }
    }
    pendingSpot = best
    const ba = best ? actOf(best.id) : null
    doorPrompt.value = best && ba ? { label: ba.label, action: 'use', slot: 0, button: ba.button } : null
  }
})

function onDoorUse() {
  const p = doorPrompt.value
  if (!p) return
  if (p.action === 'enter' && pending) enter(pending)
  else if (p.action === 'exit') exit()
  else if (p.action === 'use') (p.label === 'Stand up' ? standUp() : startUse())
}

onMounted(() => {
  window.addEventListener('kk-door-use', onDoorUse)
  window.addEventListener('kk-go-home', goHome)
  window.addEventListener('kk-stand-up', onStandUp)
  if (import.meta.dev) {
    ;(window as any).__kk_venues = () => venueDoors.map((d) => ({ type: d.venue, name: d.house.name, door: doorFront(d.house).map((v) => +v.toFixed(1)) }))
    ;(window as any).__kk_doors = () => named.map((d) => ({ name: d.house.name, door: doorFront(d.house).map((v) => +v.toFixed(1)) }))
    ;(window as any).__kk_interior = () => ({ ...interior.value, prompt: doorPrompt.value, activity: sim.activity })
    ;(window as any).__kk_enter_home = () => {
      const d = homeDoor()
      if (d) enter(d)
      return !!d
    }
    ;(window as any).__kk_room_world = (lx: number, lz: number) => (active ? toWorld(lx, lz) : null)
    ;(window as any).__kk_room_dims = () => (active ? { W: active.W, D: active.D, levels: active.floors.length } : null)
    ;(window as any).__kk_level_tick = () => updateLevel()
    ;(window as any).__kk_level = () => ({ level: interiorLevel.level, stair: interiorLevel.stair, y: +interiorLevel.y.toFixed(2), levels: interiorLevel.levels })
    ;(window as any).__kk_home_type = () => {
      homeDoor()
      return housePlacements()[homeIdx]?.type
    }
    ;(window as any).__kk_hotspots = () => (active ? allSpots().map((h) => ({ id: h.id, at: toWorld(h.x, h.z) })) : [])
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-door-use', onDoorUse)
  window.removeEventListener('kk-go-home', goHome)
  window.removeEventListener('kk-stand-up', onStandUp)
  if (active) for (const f of active.floors) f.dispose()
  interiorLevel.reset()
})
</script>

<template>
  <TresGroup>
    <primitive :object="root" />
    <TresGroup v-if="actorFrame" :position="[actorFrame.x, actorFrame.y, actorFrame.z]" :rotation-y="actorFrame.rot">
      <TresGroup v-for="a in actors" :key="a.id" :position="[a.x, 0, a.z]" :rotation-y="a.yaw">
        <CharacterAvatar
          real
          :female="a.female"
          :skin="a.look.skin"
          :shirt="a.look.top"
          :trouser="a.look.bottom"
          :hair-color="a.look.hair ?? '#141114'"
          :hair-style="a.female ? 'braids' : 'cap'"
          :kufi="false"
          :hijab="false"
          :outfit="a.female ? 'dress' : 'shirt'"
          :mode="a.mode as any"
          :seat="a.seat ?? 0.47"
          :phase="(a.id % 17) * 0.37"
          :gait-speed="a.mode === 'run' ? 14 : 9"
        />
      </TresGroup>
    </TresGroup>
    <TresSprite v-for="(s, i) in signs" :key="'sig' + i" :position="[s.x, s.y, s.z]" :scale="[9, 1.7, 1]">
      <TresSpriteMaterial :map="s.tex" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
