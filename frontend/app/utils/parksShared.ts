/** Park circles (centre + radius), filled in by Parks.vue once laid out. */
export const PARK_AREAS: Array<{ x: number; z: number; r: number; name: string }> = []
export function inPark(x: number, z: number, pad = 0): boolean {
  for (const p of PARK_AREAS) if (Math.hypot(p.x - x, p.z - z) < p.r + pad) return true
  return false
}

/** The 5-a-side pitch while a match is on (grass is cleared from it). */
export const PITCH = { active: false, x: 0, z: 0, hw: 0, hd: 0 }
export function inPitch(x: number, z: number): boolean {
  return PITCH.active && Math.abs(x - PITCH.x) < PITCH.hw && Math.abs(z - PITCH.z) < PITCH.hd
}

/** Extra grass-free areas (event crowds standing in the street etc.).
 *  Bump CLEAR_ZONES_VERSION after changing so the grass field rebuilds. */
export const CLEAR_ZONES: Array<{ x: number; z: number; r: number }> = []
export const clearZones = { version: 0 }
export function inClearZone(x: number, z: number): boolean {
  for (const c of CLEAR_ZONES) if (Math.hypot(c.x - x, c.z - z) < c.r) return true
  return false
}
