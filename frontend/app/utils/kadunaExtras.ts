// Deterministic city extras shared by the 3D renderer and the 2D map:
// CBD towers, farms, the dam, the Romi stream, construction sites, open
// (enterable) houses, and the spatial hashes used for placement clearance.
// Everything here is derived from the baked OSM layout with a fixed seed,
// so the render, the map and gameplay code all agree without a bake step.

import { BAKE } from './kaduna'

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash01(x: number, z: number, salt = 0): number {
  const h = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453
  return h - Math.floor(h)
}

// ------------------------------------------------------------ spatial hash
export interface SpatialHash {
  cell: number
  map: Map<string, Array<[number, number]>>
}

function buildHash(points: Array<[number, number]>, cell: number): SpatialHash {
  const map = new Map<string, Array<[number, number]>>()
  for (const [x, z] of points) {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`
    let arr = map.get(k)
    if (!arr) map.set(k, (arr = []))
    arr.push([x, z])
  }
  return { cell, map }
}

/** Distance to the nearest hashed point within `maxR` (units), else maxR. */
export function hashDist(h: SpatialHash, x: number, z: number, maxR = 140): number {
  const cx = Math.floor(x / h.cell)
  const cz = Math.floor(z / h.cell)
  const r = Math.ceil(maxR / h.cell)
  let best = maxR
  for (let i = -r; i <= r; i++) {
    for (let j = -r; j <= r; j++) {
      const arr = h.map.get(`${cx + i},${cz + j}`)
      if (!arr) continue
      for (const [px, pz] of arr) {
        const d = Math.hypot(px - x, pz - z)
        if (d < best) best = d
      }
    }
  }
  return best
}

// ------------------------------------------------------------ lazy singletons
let _roadHash: SpatialHash | null = null
export function roadHash(): SpatialHash {
  if (!_roadHash) {
    const pts: Array<[number, number]> = []
    for (const r of BAKE.roads) for (const p of r.pts) pts.push(p)
    _roadHash = buildHash(pts, 64)
  }
  return _roadHash
}

let _houseHash: SpatialHash | null = null
export function houseHash(): SpatialHash {
  if (!_houseHash) {
    _houseHash = buildHash(BAKE.houses.map((h) => [h[0], h[1]] as [number, number]), 64)
  }
  return _houseHash
}

let _waterHash: SpatialHash | null = null
export function waterHash(): SpatialHash {
  if (!_waterHash) {
    const pts: Array<[number, number]> = []
    for (let i = 0; i < BAKE.river.main.length; i += 2) pts.push(BAKE.river.main[i])
    for (const s of BAKE.river.side) for (let i = 0; i < s.length; i += 2) pts.push(s[i])
    for (const p of ROMI.pts) pts.push(p)
    _waterHash = buildHash(pts, 48)
  }
  return _waterHash
}

/** Approximate distance to open water (river, streams, reservoir). */
export function waterDist(x: number, z: number): number {
  return hashDist(waterHash(), x, z, 200)
}

// ------------------------------------------------------------ dam on the river
export interface DamInfo {
  x: number
  z: number
  ang: number
  /** river polyline index - everything from 0..idx is the upstream reservoir */
  idx: number
}

function makeDam(): DamInfo {
  const river = BAKE.river.main
  // river runs NE -> SW; dam sits where it leaves the city to the NE
  let idx = 0
  let best = -Infinity
  for (let i = 0; i < river.length; i++) {
    const [x, z] = river[i]
    if (x > 900 || x < -1600) continue
    const score = x - z * 0.35
    if (score > best) {
      best = score
      idx = i
    }
  }
  const [x, z] = river[idx]
  const [px, pz] = river[Math.min(idx + 3, river.length - 1)]
  return { x, z, ang: Math.atan2(px - x, pz - z), idx }
}
export const DAM = makeDam()

// ------------------------------------------------------------ Romi stream
function makeRomi(): { pts: Array<[number, number]> } {
  const river = BAKE.river.main
  // find the confluence: river point closest to the south-west approach
  let ci = 0
  let best = Infinity
  for (let i = 0; i < river.length; i++) {
    const d = Math.hypot(river[i][0] + 360, river[i][1] - 320)
    if (d < best) {
      best = d
      ci = i
    }
  }
  const raw: Array<[number, number]> = [
    [-880, 1040],
    [-760, 900],
    [-640, 760],
    [-540, 620],
    [-470, 480],
    [-420, 380],
    river[ci]
  ]
  // round the bends a little
  const pts: Array<[number, number]> = []
  for (let i = 0; i < raw.length - 1; i++) {
    const [ax, az] = raw[i]
    const [bx, bz] = raw[i + 1]
    pts.push([ax, az])
    pts.push([(ax + bx) / 2 + (hash01(ax, az) - 0.5) * 14, (az + bz) / 2 + (hash01(az, ax) - 0.5) * 14])
  }
  pts.push(raw[raw.length - 1])
  return { pts }
}
export const ROMI = makeRomi()

// ------------------------------------------------------------ CBD towers
export interface Tower {
  x: number
  z: number
  w: number
  d: number
  h: number
  glass: boolean
}

function makeTowers(): Tower[] {
  const out: Tower[] = []
  const rnd = mulberry32(0x70ad)
  // the CBD band between Murtala Square, Ahmadu Bello Way and the river
  for (let gx = -168; gx <= 40; gx += 34) {
    for (let gz = -70; gz <= 130; gz += 34) {
      if (out.length >= 16) break
      const x = gx + (rnd() - 0.5) * 8
      const z = gz + (rnd() - 0.5) * 8
      if (hashDist(roadHash(), x, z) < 11) continue
      if (hashDist(houseHash(), x, z) < 11) continue
      if (waterDist(x, z) < 26) continue
      const h = 13 + Math.floor(rnd() * 15)
      out.push({ x, z, w: 7.5 + rnd() * 2.5, d: 7.5 + rnd() * 2.5, h, glass: rnd() < 0.55 })
    }
  }
  return out
}
export const TOWERS: Tower[] = makeTowers()

// ------------------------------------------------------------ farms
export interface Farm {
  x: number
  z: number
  ang: number
  kind: 0 | 1 | 2 // maize rows / vegetables / cassava mounds
}

function makeFarms(): Farm[] {
  const out: Farm[] = []
  const rnd = mulberry32(0xf426)
  const river = BAKE.river.main
  // fadama plots hugging the river banks
  let side = 1
  for (let i = 40; i < river.length - 40; i += 9) {
    const [ax, az] = river[i]
    const [bx, bz] = river[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz) || 1
    if (ax < BAKE.meta.bounds.xmin - 30 || ax > BAKE.meta.bounds.xmax + 30) continue
    const off = BAKE.river.width / 2 + 4 + rnd() * 7
    const x = ax + (-dz / len) * off * side
    const z = az + (dx / len) * off * side
    side = -side
    if (hashDist(houseHash(), x, z) < 6) continue
    if (hashDist(roadHash(), x, z) < 5) continue
    out.push({ x, z, ang: Math.atan2(dz, dx), kind: (Math.floor(rnd() * 3) as 0 | 1 | 2) })
  }
  // outskirt field blocks
  const blocks: Array<[number, number, number, number]> = [
    [600, 560, 200, 320],
    [-1000, 1060, 180, 280],
    [140, -950, 280, 180]
  ]
  for (const [bx0, bz0, bw, bd] of blocks) {
    for (let x = bx0; x < bx0 + bw; x += 24) {
      for (let z = bz0; z < bz0 + bd; z += 22) {
        const fx = x + (rnd() - 0.5) * 4
        const fz = z + (rnd() - 0.5) * 4
        if (hashDist(houseHash(), fx, fz) < 7) continue
        if (hashDist(roadHash(), fx, fz) < 6) continue
        if (waterDist(fx, fz) < 12) continue
        out.push({ x: fx, z: fz, ang: rnd() * Math.PI, kind: (Math.floor(rnd() * 3) as 0 | 1 | 2) })
      }
    }
  }
  return out
}
export const FARMS: Farm[] = makeFarms()

// ------------------------------------------------------------ construction sites
export interface Site {
  x: number
  z: number
  rot: number
}

function makeSites(): Site[] {
  const out: Site[] = []
  const rnd = mulberry32(0x51e5)
  const anchors: Array<[number, number]> = [
    [150, 46], // CBD edge
    [640, 8], // by the Millennium estate
    [-320, 250] // Kadpoly side
  ]
  for (const [ax, az] of anchors) {
    for (let t = 0; t < 24; t++) {
      const x = ax + (rnd() - 0.5) * 46
      const z = az + (rnd() - 0.5) * 46
      if (hashDist(roadHash(), x, z) < 9) continue
      if (hashDist(houseHash(), x, z) < 9) continue
      if (waterDist(x, z) < 24) continue
      out.push({ x, z, rot: rnd() * Math.PI })
      break
    }
  }
  return out
}
export const SITES: Site[] = makeSites()

// ------------------------------------------------------------ open houses
export interface OpenHouse {
  x: number
  z: number
  w: number
  d: number
  rot: number
  /** door face normal in world space */
  nx: number
  nz: number
  name: string
}

function doorSideOf(x: number, z: number): [number, number] {
  // face the nearest road: probe the road hash around the house
  const cx = Math.floor(x / 64)
  const cz = Math.floor(z / 64)
  let bx = 0
  let bz = 0
  let best = Infinity
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const arr = roadHash().map.get(`${cx + i},${cz + j}`)
      if (!arr) continue
      for (const [px, pz] of arr) {
        const d = Math.hypot(px - x, pz - z)
        if (d < best) {
          best = d
          bx = px - x
          bz = pz - z
        }
      }
    }
  }
  if (best === Infinity) return [0, 1]
  return Math.abs(bx) > Math.abs(bz) ? [Math.sign(bx), 0] : [0, Math.sign(bz)]
}

function makeOpenHouses(): OpenHouse[] {
  const out: OpenHouse[] = []
  const areas: Array<[number, number, string]> = [
    [-98, 40, 'Home'], // the player's own street
    [-80, 102, 'Market Quarter Flat'],
    [-55, 360, 'Barnawa Guest House'],
    [114, 151, 'KASU Staff Quarters'],
    [76, -580, 'Kawo Bungalow']
  ]
  const used = new Set<string>()
  for (const [ax, az, name] of areas) {
    let bestH: (typeof BAKE.houses)[number] | null = null
    let bestScore = Infinity
    for (const h of BAKE.houses) {
      if (used.has(`${h[0]}:${h[1]}`)) continue
      const d = Math.hypot(h[0] - ax, h[1] - az)
      if (d > 260) continue
      if (h[2] < 9 || h[3] < 8) continue // roomy footprints only
      // houses sit deep inside residential blocks, so accept anything the
      // road network reaches and score by how close the street runs
      const roadD = hashDist(roadHash(), h[0], h[1], 160)
      if (roadD > 155) continue
      const clutter = hashDist(houseHash(), h[0], h[1]) // avoid tight clusters
      const score = roadD * 2 + d + clutter
      if (score < bestScore) {
        bestScore = score
        bestH = h
      }
    }
    if (!bestH) continue
    used.add(`${bestH[0]}:${bestH[1]}`)
    const [nx, nz] = doorSideOf(bestH[0], bestH[1])
    out.push({
      x: bestH[0],
      z: bestH[1],
      w: bestH[2],
      d: bestH[3],
      rot: bestH[4],
      nx,
      nz,
      name
    })
  }
  return out
}
export const OPEN_HOUSES: OpenHouse[] = makeOpenHouses()

/** Interior rooms sit directly under their house: same x/z, 60 units down. */
export const INTERIOR_DROP = 60

/** Door front position (where the enter prompt appears). */
export function doorFront(h: OpenHouse): [number, number] {
  return [h.x + h.nx * (h.w / 2 + 1.6), h.z + h.nz * (h.d / 2 + 1.6)]
}
