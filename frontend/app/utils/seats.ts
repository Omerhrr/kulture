// Street seats: every plastic chair at a kiosk and every bus-shelter bench
// registers here while the city is built, so you can sit on them.
export interface StreetSeat {
  x: number
  z: number
  /** facing (the way a seated person looks) */
  yaw: number
  h: number
  label: string
}
export const SEATS: StreetSeat[] = []
const CELL = 24
const grid = new Map<string, StreetSeat[]>()
export function registerSeat(s: StreetSeat) {
  SEATS.push(s)
  const k = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`
  let a = grid.get(k)
  if (!a) grid.set(k, (a = []))
  a.push(s)
}
export function clearSeats() {
  SEATS.length = 0
  grid.clear()
}
export function nearestSeat(x: number, z: number, r: number): StreetSeat | null {
  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  let best: StreetSeat | null = null
  let bd = r
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const s of grid.get(`${cx + i},${cz + j}`) ?? []) {
        const d = Math.hypot(s.x - x, s.z - z)
        if (d < bd) (bd = d), (best = s)
      }
  return best
}
