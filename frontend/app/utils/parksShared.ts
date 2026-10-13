/** Park circles (centre + radius), filled in by Parks.vue once laid out. */
export const PARK_AREAS: Array<{ x: number; z: number; r: number; name: string }> = []
export function inPark(x: number, z: number, pad = 0): boolean {
  for (const p of PARK_AREAS) if (Math.hypot(p.x - x, p.z - z) < p.r + pad) return true
  return false
}
