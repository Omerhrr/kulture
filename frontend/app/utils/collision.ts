// Shared collision helpers (client-side prediction only; the server is the
// authority for interactions and movement envelopes).

export interface Box {
  x: number
  z: number
  w: number
  d: number
}

// Building footprints, matching WorldScene geometry.
export const BUILDINGS: Box[] = [
  { x: -20, z: -12, w: 14, d: 10 }, // Musa's store
  { x: 0, z: -20, w: 3.4, d: 3.4 }, // POS kiosk
  { x: -40, z: -36, w: 16, d: 12 }, // AREWA House
  { x: 36, z: 24, w: 4, d: 4 }, // Stonetech monument
  { x: 30, z: -24, w: 22, d: 14 }, // market stalls block
  { x: -5.5, z: 31.5, w: 10, d: 4 } // keke stop shelter
]

export const PLAYER_RADIUS = 0.6
export const WORLD_BOUNDS = 58

export function collides(x: number, z: number): boolean {
  for (const b of BUILDINGS) {
    if (Math.abs(x - b.x) < b.w / 2 + PLAYER_RADIUS && Math.abs(z - b.z) < b.d / 2 + PLAYER_RADIUS) {
      return true
    }
  }
  return false
}

/** True when the point is inside a footprint WITHOUT the player padding. */
function insideCore(x: number, z: number): boolean {
  for (const b of BUILDINGS) {
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
  for (let r = 0.5; r <= 20; r += 0.5) {
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
  return [0, 42] // downtown spawn fallback
}

/** Clamp to world bounds. */
export function clampWorld(x: number, z: number): [number, number] {
  return [Math.max(-WORLD_BOUNDS, Math.min(WORLD_BOUNDS, x)), Math.max(-WORLD_BOUNDS, Math.min(WORLD_BOUNDS, z))]
}
