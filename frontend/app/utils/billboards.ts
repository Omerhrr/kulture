// Billboard registry: every roadside billboard the city builds registers
// here (stable ids in build order, so every client agrees on "bb-12").
// The ad screens, the map and the ad shop all read this list.
import { BAKE } from './kaduna'

export interface Billboard {
  id: string
  x: number
  z: number
  /** panel yaw (the panel's local +z is its front) */
  a: number
  road: string
  area: string
}
export const BILLBOARDS: Billboard[] = []

function nearestPlace(x: number, z: number): string {
  let best = 'Kaduna'
  let bd = Infinity
  for (const p of BAKE.places) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bd) (bd = d), (best = p.name)
  }
  return best
}

export function registerBillboard(x: number, z: number, a: number, road: string): void {
  BILLBOARDS.push({ id: `bb-${BILLBOARDS.length}`, x, z, a, road: road || 'Main road', area: nearestPlace(x, z) })
}
export const billboardById = (id: string) => BILLBOARDS.find((b) => b.id === id)
