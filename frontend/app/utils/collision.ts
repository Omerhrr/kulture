// Shared collision helpers (client-side prediction only; the server is the
// authority for interactions and movement envelopes). Colliders come from
// the baked Kaduna layout: every house footprint, landmark keepout and the
// playable structures rendered by WorldScene.

import { BAKE, clampWorld, PLAYABLE_POS } from './kaduna'
import { trafficProbe } from './trafficProbe'

export interface Box {
  x: number
  z: number
  w: number
  d: number
}

// Playable structures (WorldScene renders these at the server positions).
const at = (code: string) => {
  const p = PLAYABLE_POS[code]
  return { x: p[0], z: p[1] }
}
const PLAYABLE: Box[] = [
  { ...at('musa_shop'), w: 15, d: 11 }, // Musa's store
  { ...at('arewa_pos'), w: 4.4, d: 4.4 }, // POS kiosk
  { ...at('kaduna_central_market'), w: 54, d: 36 }, // Central Market shed block
  { ...at('arewa_house'), w: 17, d: 13 }, // Arewa House
  { ...at('stonetech_square'), w: 5, d: 5 }, // Stonetech monument
  { ...at('keke_stop'), w: 11, d: 5 }, // keke stop shelter
  // districts
  { ...at('textile_market'), w: 22, d: 13 }, // fabric stall block
  { ...at('kawo_motor_park'), w: 17, d: 6 }, // motor park canopy
  // campus gate: only the two pillars are solid, the street runs through the arch
  { x: at('kasu_gate').x - 5.6, z: at('kasu_gate').z, w: 1.8, d: 1.8 },
  { x: at('kasu_gate').x + 5.6, z: at('kasu_gate').z, w: 1.8, d: 1.8 },
  { ...at('rigasa_station'), w: 32, d: 7 }, // platform canopy
  { ...at('sabon_tasha_shop'), w: 13, d: 10 } // community store
]

function buildColliders(): Box[] {
  const boxes: Box[] = [...PLAYABLE]
  // Only genuinely solid landmarks get collision boxes. Open areas (plazas,
  // the market floor, campuses, the stadium bowl, parks) stay walkable.
  const solidKinds = new Set([
    'cathedral',
    'mosque',
    'govhouse',
    'hotel',
    'museum',
    'hospital',
    'factory',
    'refinery',
    'station',
    'junction',
    'mast'
  ])
  for (const lm of BAKE.landmarks) {
    if (lm.kw > 0 && solidKinds.has(lm.kind)) {
      boxes.push({ x: lm.x, z: lm.z, w: lm.kw, d: lm.kd })
    }
  }
  // compounds: the footprint IS the compound wall, so it is solid all
  // round. Use the AABB of the rotated rectangle (grid houses along N-S
  // streets are turned 90 degrees, so w/d must swap).
  for (const h of BAKE.houses) {
    const c = Math.abs(Math.cos(h[4]))
    const sn = Math.abs(Math.sin(h[4]))
    boxes.push({ x: h[0], z: h[1], w: h[2] * c + h[3] * sn, d: h[2] * sn + h[3] * c })
  }
  // CBD towers incl. their retail podium
  for (const t of BAKE.towers ?? []) {
    boxes.push({ x: t.x, z: t.z, w: t.w + 8, d: t.d + 8 })
  }
  // hospitals, schools, filling stations, workshops (solid parts only)
  for (const b of BAKE.civicSolids ?? []) boxes.push(b)
  return boxes
}

export const BUILDINGS: Box[] = buildColliders()

// Uniform grid over the building boxes: ~15k footprints across the city, so
// a linear scan per query (player + every pedestrian, every frame) is far
// too slow. Each box is filed in every cell it overlaps.
const CELL = 32
const grid = new Map<number, Box[]>()
const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096)
for (const b of BUILDINGS) {
  const i0 = Math.floor((b.x - b.w / 2 - 1) / CELL)
  const i1 = Math.floor((b.x + b.w / 2 + 1) / CELL)
  const j0 = Math.floor((b.z - b.d / 2 - 1) / CELL)
  const j1 = Math.floor((b.z + b.d / 2 + 1) / CELL)
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const k = key(i, j)
      let a = grid.get(k)
      if (!a) grid.set(k, (a = []))
      a.push(b)
    }
  }
}
const EMPTY: Box[] = []

/** Register extra solid boxes at runtime (street props, tree trunks,
 *  poles) built by the renderer. */
export function addColliders(list: Box[]) {
  for (const b of list) {
    const i0 = Math.floor((b.x - b.w / 2 - 1) / CELL)
    const i1 = Math.floor((b.x + b.w / 2 + 1) / CELL)
    const j0 = Math.floor((b.z - b.d / 2 - 1) / CELL)
    const j1 = Math.floor((b.z + b.d / 2 + 1) / CELL)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j)
        let a = grid.get(k)
        if (!a) grid.set(k, (a = []))
        a.push(b)
      }
    }
  }
}
/** True if a building box, grown by `pad`, contains (x, z). */
export function hitsBuilding(x: number, z: number, pad: number): boolean {
  const i0 = Math.floor((x - pad) / CELL)
  const i1 = Math.floor((x + pad) / CELL)
  const j0 = Math.floor((z - pad) / CELL)
  const j1 = Math.floor((z + pad) / CELL)
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const a = grid.get(key(i, j))
      if (!a) continue
      for (const b of a) {
        if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return true
      }
    }
  }
  return false
}
/**
 * Do two oriented rectangles overlap? (separating-axis test). Each is a
 * centre, a heading h (forward = (sin h, cos h)) and half-length / half-width.
 */
export function obbOverlap(
  ax: number, az: number, ah: number, ahl: number, ahw: number,
  bx: number, bz: number, bh: number, bhl: number, bhw: number
): boolean {
  const afx = Math.sin(ah), afz = Math.cos(ah)
  const bfx = Math.sin(bh), bfz = Math.cos(bh)
  const dx = bx - ax, dz = bz - az
  // the four candidate axes: each box's forward and right
  const axes = [afx, afz, afz, -afx, bfx, bfz, bfz, -bfx]
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i]!, nz = axes[i + 1]!
    const ra = ahl * Math.abs(afx * nx + afz * nz) + ahw * Math.abs(afz * nx - afx * nz)
    const rb = bhl * Math.abs(bfx * nx + bfz * nz) + bhw * Math.abs(bfz * nx - bfx * nz)
    if (Math.abs(dx * nx + dz * nz) > ra + rb) return false
  }
  return true
}

/** Buildings whose cell contains (x, z). Pad is small (< 1 cell). */
export function buildingsNear(x: number, z: number): Box[] {
  return grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? EMPTY
}

export const PLAYER_RADIUS = 0.6
// Indoors the body is slimmer so the bedroom / bathroom doorways and the
// gaps between furniture are walkable (a person is ~0.5 m across).
export const INTERIOR_RADIUS = 0.28
// Downtown fallback spawn (Ahmadu Bello Way roadside).
export const SPAWN: [number, number] = PLAYABLE_POS.spawn_roadside

// While the player is inside a house interior the room's own walls replace
// the city colliders (the room sits directly below the house footprint, so
// x/z never leaves the world rectangle and the server envelope is happy).
let interiorWalls: Box[] | null = null
export function setInteriorWalls(boxes: Box[] | null) {
  interiorWalls = boxes
}

// Parked / boardable vehicles block the player on foot (no more walking
// through cars). RideSystem registers its fleet here on mount; while you
// are driving, your own vehicle is excluded via the ride flag below.
let vehicleBoxes: Box[] = []
export function setVehicleObstacles(boxes: Box[]) {
  vehicleBoxes = boxes
}

/**
 * Vehicles are solid to anyone on foot: the parked fleet above plus every
 * live vehicle in the traffic probe (ambient cars, kekes, the train, the
 * plane and the player's ride). Enter-block semantics: moving INTO a
 * vehicle is blocked, but a vehicle that stopped on top of you never traps
 * you - walking out of it stays allowed.
 */
function entersVehicle(ox: number, oz: number, x: number, z: number, r: number): boolean {
  for (const b of vehicleBoxes) {
    if (Math.abs(x - b.x) >= b.w / 2 + r || Math.abs(z - b.z) >= b.d / 2 + r) continue
    if (Math.abs(ox - b.x) < b.w / 2 + r && Math.abs(oz - b.z) < b.d / 2 + r) continue
    return true
  }
  for (const c of trafficProbe.cars) {
    const rr = c.r * 0.85 + r
    const dx = x - c.x
    const dz = z - c.z
    if (dx * dx + dz * dz >= rr * rr) continue
    const d0x = ox - c.x
    const d0z = oz - c.z
    if (d0x * d0x + d0z * d0z >= rr * rr) return true
  }
  return false
}

export function collides(x: number, z: number, ox = x, oz = z): boolean {
  if (interiorWalls) {
    const r = INTERIOR_RADIUS
    for (const b of interiorWalls) {
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) {
        // already touching it (e.g. just stood up from the bed)? let you walk out
        const moved = ox !== x || oz !== z
        if (moved && Math.abs(ox - b.x) < b.w / 2 + r && Math.abs(oz - b.z) < b.d / 2 + r) continue
        return true
      }
    }
    return false
  }
  for (const b of buildingsNear(x, z)) {
    if (Math.abs(x - b.x) < b.w / 2 + PLAYER_RADIUS && Math.abs(z - b.z) < b.d / 2 + PLAYER_RADIUS) {
      return true
    }
  }
  if (entersVehicle(ox, oz, x, z, PLAYER_RADIUS)) return true
  return false
}

/** Pedestrians use a smaller radius when testing the same boxes. */
export function collidesRadius(x: number, z: number, r: number, ox = x, oz = z): boolean {
  if (interiorWalls) {
    for (const b of interiorWalls) {
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true
    }
    return false
  }
  if (hitsBuilding(x, z, r)) return true
  if (entersVehicle(ox, oz, x, z, r)) return true
  return false
}

/** True when the point is inside a footprint WITHOUT the player padding. */
function insideCore(x: number, z: number): boolean {
  for (const b of buildingsNear(x, z)) {
    if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return true
  }
  for (const b of vehicleBoxes) {
    if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return true
  }
  return false
}

/**
 * Nudge a point that may sit inside a building footprint outward to the
 * nearest free spot. Used on spawn/seed: a stale persisted position must
 * never trap the character inside a collision box.
 */
export function unstick(x: number, z: number): [number, number] {
  if (!collides(x, z)) return [x, z]
  // Try progressively wider rings around the point, axis-aligned first
  // (feels natural when walking out of a wall), then diagonals.
  for (let r = 0.5; r <= 24; r += 0.5) {
    const candidates: Array<[number, number]> = [
      [x, z - r],
      [x, z + r],
      [x - r, z],
      [x + r, z],
      [x - r * 0.707, z - r * 0.707],
      [x + r * 0.707, z - r * 0.707],
      [x - r * 0.707, z + r * 0.707],
      [x + r * 0.707, z + r * 0.707]
    ]
    for (const [cx, cz] of candidates) {
      if (!collides(cx, cz) && !insideCore(cx, cz)) return [cx, cz]
    }
  }
  return SPAWN // downtown fallback
}

/** Clamp to the walkable world rectangle. */
export function clampBounds(x: number, z: number): [number, number] {
  return clampWorld(x, z)
}
