// terrain - gentle savanna hills in the empty land between roads.
// Everything built (roads, houses, farms, sites, the river) stays on flat
// ground at y = 0: the hill height is multiplied by a mask that is zero
// near any of them and only rises in open country, so slopes roll up
// behind the verges like the land outside a real town. One shared,
// cached height function feeds the ground mesh, grass, trees and the
// walking player so everything sits on the same surface.
import { hash01, hashDist, roadHash, houseHash, waterHash, FARMS, SITES } from '~/utils/kadunaExtras'

const AMP = 42 // peak hill height (m)
const CELL = 48 // cache resolution (m)

function vnoise(x: number, z: number, salt: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const fx = x - xi
  const fz = z - zi
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash01(xi, zi, salt)
  const b = hash01(xi + 1, zi, salt)
  const c = hash01(xi, zi + 1, salt)
  const d = hash01(xi + 1, zi + 1, salt)
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz
}

/** Rolling fbm in 0..1: broad swells with smaller knolls on top. */
function hills(x: number, z: number): number {
  let v = 0
  let amp = 0.55
  let f = 1 / 520
  for (let o = 0; o < 4; o++) {
    v += vnoise(x * f, z * f, 17 + o * 7) * amp
    amp *= 0.48
    f *= 2.1
  }
  // sharpen the crests a little so they read as hills, not bumps
  return Math.pow(Math.max(0, v - 0.18) / 0.82, 1.35)
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

let built: Array<[number, number, number]> | null = null
function builtPoints() {
  if (!built) {
    built = []
    for (const f of FARMS) built.push([f.x, f.z, 70])
    for (const s of SITES) built.push([s.x, s.z, 50])
  }
  return built
}

/** Open-country mask 0 (built-up / roads / water) .. 1 (wild land). */
function openMask(x: number, z: number): number {
  const rd = hashDist(roadHash(), x, z, 190)
  if (rd < 45) return 0
  const hd = hashDist(houseHash(), x, z, 150)
  if (hd < 32) return 0
  const wd = hashDist(waterHash(), x, z, 200)
  let m = smooth(45, 140, rd) * smooth(32, 110, hd) * smooth(50, 170, wd)
  for (const [bx, bz, r] of builtPoints()) {
    const R = r + 120
    const dx = x - bx
    const dz = z - bz
    if (dx > R || dx < -R || dz > R || dz < -R) continue // cheap reject first
    const d = Math.hypot(dx, dz)
    if (d < R) m *= smooth(r, R, d)
  }
  return m
}

const cache = new Map<number, number>()
function cellHeight(ci: number, cj: number): number {
  const key = ci * 1000003 + cj
  let h = cache.get(key)
  if (h === undefined) {
    const x = ci * CELL
    const z = cj * CELL
    const m = openMask(x, z)
    h = m > 0 ? hills(x, z) * AMP * m : 0
    cache.set(key, h)
  }
  return h
}

/** Ground height at a world point (bilinear over the cached grid). */
export function heightAt(x: number, z: number): number {
  const fx = x / CELL
  const fz = z / CELL
  const ci = Math.floor(fx)
  const cj = Math.floor(fz)
  const tx = fx - ci
  const tz = fz - cj
  const a = cellHeight(ci, cj)
  const b = cellHeight(ci + 1, cj)
  const c = cellHeight(ci, cj + 1)
  const d = cellHeight(ci + 1, cj + 1)
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
}
