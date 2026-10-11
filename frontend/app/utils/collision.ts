// Shared collision helpers (client-side prediction only; the server is the
// authority for interactions and movement envelopes). Colliders come from
// the baked Kaduna layout: every house footprint, landmark keepout and the
// playable structures rendered by WorldScene.

import { BAKE, clampWorld } from './kaduna'

export interface Box {
  x: number
  z: number
  w: number
  d: number
}

// Playable structures (WorldScene renders these at the server positions).
const PLAYABLE: Box[] = [
  { x: -70, z: 75, w: 15, d: 11 }, // Musa's store
  { x: -25, z: 8, w: 4.4, d: 4.4 }, // POS kiosk
  { x: -80, z: 102, w: 54, d: 36 }, // Central Market shed block
  { x: -20, z: -164, w: 17, d: 13 }, // Arewa House
  { x: -55, z: 360, w: 5, d: 5 }, // Stonetech monument
  { x: -245, z: 420, w: 11, d: 5 } // keke stop shelter
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
  for (const h of BAKE.houses) {
    boxes.push({ x: h[0], z: h[1], w: h[2], d: h[3] })
  }
  return boxes
}

export const BUILDINGS: Box[] = buildColliders()

export const PLAYER_RADIUS = 0.6
// Downtown fallback spawn (Ahmadu Bello Way roadside).
export const SPAWN: [number, number] = [-98, 40]

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

export function collides(x: number, z: number): boolean {
  if (interiorWalls) {
    for (const b of interiorWalls) {
      if (Math.abs(x - b.x) < b.w / 2 + PLAYER_RADIUS && Math.abs(z - b.z) < b.d / 2 + PLAYER_RADIUS) {
        return true
      }
    }
    return false
  }
  for (const b of BUILDINGS) {
    if (Math.abs(x - b.x) < b.w / 2 + PLAYER_RADIUS && Math.abs(z - b.z) < b.d / 2 + PLAYER_RADIUS) {
      return true
    }
  }
  for (const b of vehicleBoxes) {
    if (Math.abs(x - b.x) < b.w / 2 + PLAYER_RADIUS && Math.abs(z - b.z) < b.d / 2 + PLAYER_RADIUS) {
      return true
    }
  }
  return false
}

/** Pedestrians use a smaller radius when testing the same boxes. */
export function collidesRadius(x: number, z: number, r: number): boolean {
  if (interiorWalls) {
    for (const b of interiorWalls) {
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true
    }
    return false
  }
  for (const b of BUILDINGS) {
    if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true
  }
  return false
}

/** True when the point is inside a footprint WITHOUT the player padding. */
function insideCore(x: number, z: number): boolean {
  for (const b of BUILDINGS) {
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
