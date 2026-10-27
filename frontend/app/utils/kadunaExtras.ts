// Deterministic city extras shared by the 3D renderer and the 2D map:
// CBD towers, farms, the dam, the Romi stream, construction sites, open
// (enterable) houses, and the spatial hashes used for placement clearance.
// Everything here is derived from the baked OSM layout with a fixed seed,
// so the render, the map and gameplay code all agree without a bake step.

import { BAKE, WORLD_SCALE, ws, wp, IS_CITY, densePoints } from './kaduna'

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
  map: Map<number, Array<[number, number]>>
}

/** numeric cell key (string keys made every lookup allocate) */
export const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)

function buildHash(points: Array<[number, number]>, cell: number): SpatialHash {
  const map = new Map<number, Array<[number, number]>>()
  for (const [x, z] of points) {
    const k = cellKey(Math.floor(x / cell), Math.floor(z / cell))
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
  // search ring by ring outward; a point in ring k is at least (k-1) cells
  // away, so once that exceeds the best distance nothing closer remains
  let best2 = maxR * maxR
  for (let k = 0; k <= r; k++) {
    const minD = (k - 1) * h.cell
    if (k > 1 && minD * minD >= best2) break
    for (let i = -k; i <= k; i++) {
      const edge = i === -k || i === k
      for (let j = -k; j <= k; j += edge ? 1 : 2 * k) {
        const arr = h.map.get(cellKey(cx + i, cz + j))
        if (arr) {
          for (let n = 0; n < arr.length; n++) {
            const p = arr[n]!
            const dx = p[0] - x
            const dz = p[1] - z
            const d2 = dx * dx + dz * dz
            if (d2 < best2) best2 = d2
          }
        }
        if (k === 0) break
      }
    }
  }
  return Math.min(maxR, Math.sqrt(best2))
}

// ------------------------------------------------------------ lazy singletons
let _roadHash: SpatialHash | null = null
export function roadHash(): SpatialHash {
  if (!_roadHash) {
    const pts: Array<[number, number]> = []
    // densify long segments: after WORLD_SCALE a polyline vertex can be
    // 100+ units from its neighbour, and a vertex-only hash would report
    // open ground in the middle of a straight road
    for (const r of BAKE.roads) {
      for (let i = 0; i < r.pts.length; i++) {
        const [ax, az] = r.pts[i]
        pts.push([ax, az])
        const b = r.pts[i + 1]
        if (!b) continue
        const n = Math.floor(Math.hypot(b[0] - ax, b[1] - az) / 8)
        for (let k = 1; k < n; k++) pts.push([ax + ((b[0] - ax) * k) / n, az + ((b[1] - az) * k) / n])
      }
    }
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
    pts.push(...densePoints(BAKE.river.main, 24))
    for (const s of BAKE.river.side) pts.push(...densePoints(s, 24))
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
    if (x > ws(900) || x < ws(-1600)) continue
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
    const d = Math.hypot(river[i][0] - ws(-360), river[i][1] - ws(320))
    if (d < best) {
      best = d
      ci = i
    }
  }
  const raw: Array<[number, number]> = [
    wp([-880, 1040]),
    wp([-760, 900]),
    wp([-640, 760]),
    wp([-540, 620]),
    wp([-470, 480]),
    wp([-420, 380]),
    river[ci]
  ]
  // round the bends a little
  const pts: Array<[number, number]> = []
  for (let i = 0; i < raw.length - 1; i++) {
    const [ax, az] = raw[i]
    const [bx, bz] = raw[i + 1]
    pts.push([ax, az])
    pts.push([(ax + bx) / 2 + (hash01(ax, az) - 0.5) * 14 * WORLD_SCALE, (az + bz) / 2 + (hash01(az, ax) - 0.5) * 14 * WORLD_SCALE])
  }
  pts.push(raw[raw.length - 1])
  return { pts }
}
export const ROMI = IS_CITY ? makeRomi() : { pts: [] as Array<[number, number]> }

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
  // placed with the street grid in kaduna.ts (they claim whole CBD blocks)
  return BAKE.towers ?? []
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
    [ws(600), ws(560), ws(200), ws(320)],
    [ws(-1000), ws(1060), ws(180), ws(280)],
    [ws(140), ws(-950), ws(280), ws(180)]
  ]
  for (const [bx0, bz0, bw, bd] of blocks) {
    for (let x = bx0; x < bx0 + bw; x += 30) {
      for (let z = bz0; z < bz0 + bd; z += 26) {
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
    wp([150, 46]), // CBD edge
    wp([640, 8]), // by the Millennium estate
    wp([-320, 250]) // Kadpoly side
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
      const arr = roadHash().map.get(cellKey(cx + i, cz + j))
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
  // in the other towns: a guest house by the market, then the districts
  const townAreas = (): Array<[number, number, string]> => {
    const m = BAKE.landmarks.find((l) => l.kind === 'market') ?? BAKE.landmarks[0]
    const out: Array<[number, number, string]> = m ? [[m.x, m.z, 'Guest House']] : []
    for (const p of BAKE.places.slice(0, 4)) out.push([p.x, p.z, `${p.name} Lodge`])
    return out
  }
  const areas: Array<[number, number, string]> = IS_CITY
    ? (
        [
          [-60.667, 85.483, 'Home'], // the player's own street (by the spawn)
          [-80, 102, 'Market Quarter Flat'],
          [-55, 360, 'Barnawa Guest House'],
          [114, 151, 'KASU Staff Quarters'],
          [76, -580, 'Kawo Bungalow']
        ] as Array<[number, number, string]>
      ).map(([x, z, n]) => [ws(x), ws(z), n])
    : townAreas()
  const used = new Set<string>()
  for (const [ax, az, name] of areas) {
    let bestH: (typeof BAKE.houses)[number] | null = null
    let bestScore = Infinity
    for (const h of BAKE.houses) {
      if (used.has(`${h[0]}:${h[1]}`)) continue
      const d = Math.hypot(h[0] - ax, h[1] - az)
      if (d > ws(260)) continue
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
