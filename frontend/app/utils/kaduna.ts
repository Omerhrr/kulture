// Kaduna city layout, baked from OpenStreetMap data by
// scripts/kaduna-osm/bake_kaduna.py. Origin = Murtala Square, +X = east,
// +Z = south (Three.js convention).
//
// SCALE: the bake stores the city at 1 unit = 10 m (a 1:10 miniature), but
// every object you can touch - people, cars, doors, houses - is modeled at
// 1 unit = 1 m. Rendering both together made the city feel like a cramped
// model village. WORLD_SCALE stretches the *map* (every position, road,
// river and bound) so it sits much closer to the 1 unit = 1 m of the
// objects, while footprints stay in real meters. 3.0 gives a ~6.3 x 7.4 km
// playable Kaduna: big enough to feel like a city, small enough to cross by
// keke in a few minutes. The backend mirrors this value in
// settings.world_scale - keep the two in sync.
//
// Data: (c) OpenStreetMap contributors, ODbL. Geometry is stylized and
// approximate; landmark positions follow OSM where mapped.

import bakeJson from './kadunaBake.json'

export interface BakeRoad {
  name: string
  class: string
  pts: [number, number][]
  /** one carriageway of a dual carriageway pair (set at load) */
  twin?: boolean
}
export interface BakeLandmark {
  key: string
  name: string
  x: number
  z: number
  kind: string
  kw: number
  kd: number
  lh: number
}
export interface BakePlace {
  name: string
  x: number
  z: number
}
export interface BakeBridge {
  name: string
  x: number
  z: number
  rot: number
  w: number
}
export interface KadunaBake {
  meta: {
    attribution: string
    origin: number[]
    unitM: number
    bounds: { xmin: number; xmax: number; zmin: number; zmax: number }
  }
  river: { main: [number, number][]; width: number; side: [number, number][][] }
  roads: BakeRoad[]
  rail: [number, number][][]
  airport: { runway: [number, number][] | null; apron: { x: number; z: number; w: number; d: number } | null }
  landmarks: BakeLandmark[]
  places: BakePlace[]
  bridges: BakeBridge[]
  houses: [number, number, number, number, number, number, number][]
  housePalettes: { wall: string[]; roof: string[] }
  trees: [number, number, number][]
  /** CBD high-rises (generated at load, see densify) */
  towers?: { x: number; z: number; w: number; d: number; h: number; glass: boolean }[]
  /** public buildings placed at load (see placeCivic) */
  civic?: CivicSite[]
  /** collision boxes (AABB) for the solid parts of civic sites */
  civicSolids?: { x: number; z: number; w: number; d: number }[]
}

export type CivicKind = 'hospital' | 'school' | 'fuel' | 'mechanic'
export interface CivicSite {
  kind: CivicKind
  x: number
  z: number
  /** lot size: w along the frontage, d deep */
  w: number
  d: number
  /** facing: local +z points at the street */
  yaw: number
  name: string
}

export const WORLD_SCALE = 3

// server-owned playable entities (world_entities rows), RAW bake units.
// Mirrors backend/app/seed/seed_data.py ENTITIES. Placed so each spot
// fronts a street of the generated grid (see scripts in the PR notes).
/** Clear radius (m) around each playable spot where no house may stand. */
const PLAYABLE_CLEAR: Record<string, number> = {
  musa_shop: 11,
  arewa_pos: 5,
  kaduna_central_market: 34,
  arewa_house: 12,
  stonetech_square: 15,
  keke_stop: 9,
  spawn_roadside: 2,
  npc_musa: 2,
  npc_amina: 2,
  textile_market: 13,
  kawo_motor_park: 12,
  kasu_gate: 11,
  rigasa_station: 13,
  sabon_tasha_shop: 10,
  npc_mama_chidi: 2,
  npc_bashir: 2,
  npc_prof_danjuma: 2,
  npc_tunde: 2,
  npc_ngozi: 2
}
const PLAYABLE_RAW: Record<string, [number, number]> = {
  spawn_roadside: [-60.667, 85.483],
  musa_shop: [-49.333, 80.183],
  arewa_pos: [-34.667, -2.683],
  kaduna_central_market: [-70.0, 98.0],
  arewa_house: [-34.667, -144.45],
  stonetech_square: [-42.0, 350.0],
  keke_stop: [-245.0, 417.05],
  npc_musa: [-50.5, 82.583],
  npc_amina: [-43.667, 349.333],
  // districts (see seed_data.py ENTITIES - same raw coordinates)
  textile_market: [-186.0, 640.0],
  kawo_motor_park: [76.0, -546.0],
  kasu_gate: [114.0, 108.0],
  rigasa_station: [-943.0, -134.0],
  sabon_tasha_shop: [252.0, 1042.0],
  npc_mama_chidi: [-181.0, 631.0],
  npc_bashir: [69.0, -542.0],
  npc_prof_danjuma: [107.0, 104.0],
  npc_tunde: [-936.0, -130.0],
  npc_ngozi: [246.0, 1036.0]
}


/** Scale a raw (baked, 1u = 10 m) map coordinate into world units. */
export const ws = (v: number) => v * WORLD_SCALE
/** Scale a raw [x, z] map point into world units. */
export const wp = (p: readonly [number, number] | number[]): [number, number] => [p[0] * WORLD_SCALE, p[1] * WORLD_SCALE]

function scaleBake(raw: KadunaBake): KadunaBake {
  const S = WORLD_SCALE
  const pts = (a: [number, number][]) => a.map((p) => wp(p))
  return {
    meta: {
      ...raw.meta,
      unitM: raw.meta.unitM / S,
      bounds: {
        xmin: raw.meta.bounds.xmin * S,
        xmax: raw.meta.bounds.xmax * S,
        zmin: raw.meta.bounds.zmin * S,
        zmax: raw.meta.bounds.zmax * S
      }
    },
    // the river gets wider too (River Kaduna is ~100-150 m across)
    river: { main: pts(raw.river.main), width: raw.river.width * S * 0.9, side: raw.river.side.map(pts) },
    roads: raw.roads.map((r) => ({ ...r, pts: pts(r.pts) })),
    rail: raw.rail.map(pts),
    airport: {
      runway: raw.airport.runway ? pts(raw.airport.runway) : null,
      apron: raw.airport.apron
        ? { x: raw.airport.apron.x * S, z: raw.airport.apron.z * S, w: raw.airport.apron.w * S, d: raw.airport.apron.d * S }
        : null
    },
    // landmark footprints were already authored in meters - only move them
    // the market landmark follows the playable market entity so the vendor
    // stalls, the crowd and the server's market all agree
    landmarks: raw.landmarks.map((l) =>
      l.kind === 'market'
        ? { ...l, x: PLAYABLE_RAW.kaduna_central_market[0] * S, z: PLAYABLE_RAW.kaduna_central_market[1] * S, kw: 48, kd: 36 }
        : { ...l, x: l.x * S, z: l.z * S }
    ),
    places: raw.places.map((p) => ({ ...p, x: p.x * S, z: p.z * S })),
    bridges: raw.bridges.map((b) => ({ ...b, x: b.x * S, z: b.z * S, w: b.w * S })),
    // footprints (w, d) stay in meters: positions move, houses stay house-sized
    houses: raw.houses.map((h) => [h[0] * S, h[1] * S, h[2], h[3], h[4], h[5], h[6]] as KadunaBake['houses'][number]),
    housePalettes: raw.housePalettes,
    trees: raw.trees.map((t) => [t[0] * S, t[1] * S, t[2]] as [number, number, number])
  }
}

/** Real-world street widths (asphalt only, meters): dual carriageway trunk
 *  roads, two-lane primaries, residential streets. Shared by the renderer,
 *  traffic lanes, pedestrians and street furniture. */
export function roadWidth(cls: string): number {
  return cls === 'trunk' ? 13 : cls === 'primary' ? 9.5 : 6.5
}
/** Asphalt width of a specific road: one-way halves of a dual carriageway
 *  are narrower than a two-way road of the same class. */
export function roadW(r: { class: string; twin?: boolean }): number {
  return r.twin ? (r.class === 'trunk' ? 8.5 : 7.5) : roadWidth(r.class)
}
/** Sidewalk + shoulder width on each side of the asphalt. */
export const SIDEWALK_W = 2.6

// ------------------------------------------------------------ densify
// Stretching the map 3x spreads the OSM-sampled houses 3x apart, which
// reads as empty farmland. Infill adds modern compounds around every
// sampled house (same street orientation, deterministic seed), keeps them
// off roads, water and each other, and drops any original house that the
// wider real-size roads now run through.
function seeded(seed: number) {
  let a = seed
  return () => {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type PtHash = Map<string, Array<[number, number, number]>>
const HC = 40
function hput(h: PtHash, x: number, z: number, r: number) {
  const k = `${Math.floor(x / HC)},${Math.floor(z / HC)}`
  let a = h.get(k)
  if (!a) h.set(k, (a = []))
  a.push([x, z, r])
}
/** true if (x, z) with radius r overlaps any hashed disc (plus gap). */
function hhit(h: PtHash, x: number, z: number, r: number, gap: number): boolean {
  const cx = Math.floor(x / HC)
  const cz = Math.floor(z / HC)
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const a = h.get(`${cx + i},${cz + j}`)
      if (!a) continue
      for (const [px, pz, pr] of a) {
        const lim = pr + r + gap
        const dx = px - x
        const dz = pz - z
        if (dx * dx + dz * dz < lim * lim) return true
      }
    }
  }
  return false
}

function markTwins(b: KadunaBake) {
  const mains = b.roads.filter((r) => r.class === 'trunk' || r.class === 'primary')
  const segDist = (px: number, pz: number, pts: [number, number][]) => {
    let best = Infinity
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const dx = pts[i + 1][0] - ax
      const dz = pts[i + 1][1] - az
      const l2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2))
      best = Math.min(best, Math.hypot(ax + dx * t - px, az + dz * t - pz))
    }
    return best
  }
  for (const a of mains) {
    if (a.twin) continue
    const mid = a.pts[Math.floor(a.pts.length / 2)]
    for (const o of mains) {
      if (o === a || o.name !== a.name) continue
      if (segDist(mid[0], mid[1], o.pts) < 9) {
        a.twin = true
        o.twin = true
        break
      }
    }
  }
}

function addHashedRoad(h: PtHash, pts: [number, number][], half: number, step = 4) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
    for (let k = 0; k <= n; k++) hput(h, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, half)
  }
}

/** Distance from (x, z) to the nearest hashed disc edge (Infinity if none in range). */
function hnear(h: PtHash, x: number, z: number): number {
  const cx = Math.floor(x / HC)
  const cz = Math.floor(z / HC)
  let best = Infinity
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const a = h.get(`${cx + i},${cz + j}`)
      if (!a) continue
      for (const [px, pz, pr] of a) {
        const d = Math.hypot(px - x, pz - z) - pr
        if (d < best) best = d
      }
    }
  }
  return best
}

// ------------------------------------------------------------ street grid
// The OSM extract only carries the arterial roads. Real Kaduna districts
// are a dense mesh of residential streets lined with compounds, so we lay a
// street grid over every developed area (where the bake has houses or along
// the arterials near town), skipping water, landmarks and the runway.
const BLOCK = 84
const URBAN_R = 2500 // m from Murtala Square that counts as town

function streetGrid(b: KadunaBake, mains: PtHash, water: PtHash, keep: PtHash, runway: PtHash): { roads: KadunaBake['roads']; dev: Set<string> } {
  const bx0 = Math.floor(b.meta.bounds.xmin / BLOCK)
  const bx1 = Math.ceil(b.meta.bounds.xmax / BLOCK)
  const bz0 = Math.floor(b.meta.bounds.zmin / BLOCK)
  const bz1 = Math.ceil(b.meta.bounds.zmax / BLOCK)
  // original houses per cell (with a one-cell halo) mark settlements
  const houseCount = new Map<string, number>()
  for (const h of b.houses) {
    const i = Math.floor(h[0] / BLOCK)
    const j = Math.floor(h[1] / BLOCK)
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const k = `${i + di},${j + dj}`
        houseCount.set(k, (houseCount.get(k) ?? 0) + (di === 0 && dj === 0 ? 2 : 1))
      }
    }
  }
  const dev = new Set<string>()
  for (let i = bx0; i < bx1; i++) {
    for (let j = bz0; j < bz1; j++) {
      const cx = (i + 0.5) * BLOCK
      const cz = (j + 0.5) * BLOCK
      const r0 = Math.hypot(cx, cz)
      const settled = (houseCount.get(`${i},${j}`) ?? 0) >= 2
      const nearMain = hnear(mains, cx, cz) < 160
      if (!(settled || (nearMain && r0 < URBAN_R))) continue
      if (r0 > URBAN_R * 1.5 && !settled) continue
      if (hnear(water, cx, cz) < 10 || hnear(keep, cx, cz) < 0 || hnear(runway, cx, cz) < 30) continue
      dev.add(`${i},${j}`)
    }
  }
  const blocked = (x: number, z: number) =>
    hnear(water, x, z) < 4 || hnear(keep, x, z) < -4 || hnear(runway, x, z) < 10
  const edgeOk = (ax: number, az: number, bx: number, bz: number) => {
    let alongMain = 0
    for (let k = 0; k <= 4; k++) {
      const x = ax + ((bx - ax) * k) / 4
      const z = az + ((bz - az) * k) / 4
      if (blocked(x, z)) return false
      if (hnear(mains, x, z) < 10) alongMain++
    }
    return alongMain < 3 // don't double up an arterial with a parallel street
  }
  const out: KadunaBake['roads'] = []
  // horizontal streets (constant z), merged into runs
  for (let j = bz0; j <= bz1; j++) {
    let run: [number, number][] = []
    for (let i = bx0; i < bx1; i++) {
      const on = (dev.has(`${i},${j}`) || dev.has(`${i},${j - 1}`)) && edgeOk(i * BLOCK, j * BLOCK, (i + 1) * BLOCK, j * BLOCK)
      if (on) {
        if (!run.length) run.push([i * BLOCK, j * BLOCK])
        run.push([(i + 1) * BLOCK, j * BLOCK])
      } else if (run.length) {
        out.push({ name: '', class: 'residential', pts: run })
        run = []
      }
    }
    if (run.length) out.push({ name: '', class: 'residential', pts: run })
  }
  // vertical streets (constant x)
  for (let i = bx0; i <= bx1; i++) {
    let run: [number, number][] = []
    for (let j = bz0; j < bz1; j++) {
      const on = (dev.has(`${i},${j}`) || dev.has(`${i - 1},${j}`)) && edgeOk(i * BLOCK, j * BLOCK, i * BLOCK, (j + 1) * BLOCK)
      if (on) {
        if (!run.length) run.push([i * BLOCK, j * BLOCK])
        run.push([i * BLOCK, (j + 1) * BLOCK])
      } else if (run.length) {
        out.push({ name: '', class: 'residential', pts: run })
        run = []
      }
    }
    if (run.length) out.push({ name: '', class: 'residential', pts: run })
  }
  return { roads: out, dev }
}

function densify(b: KadunaBake): KadunaBake {
  markTwins(b)
  const mains: PtHash = new Map()
  for (const r of b.roads) addHashedRoad(mains, r.pts, roadW(r) / 2 + SIDEWALK_W)
  const water: PtHash = new Map()
  for (const [x, z] of b.river.main) hput(water, x, z, b.river.width / 2 + 8)
  for (const s of b.river.side) for (const [x, z] of s) hput(water, x, z, b.river.width * 0.35 + 6)
  const keep: PtHash = new Map()
  for (const l of b.landmarks) if (l.kw > 0) hput(keep, l.x, l.z, Math.hypot(l.kw, l.kd) / 2 + 10)
  // the playable spots get exactly their own footprint cleared (houses
  // only - the streets they front stay)
  const keepHouses: PtHash = new Map()
  for (const [code, [x, z]] of Object.entries(PLAYABLE_RAW)) hput(keepHouses, x * WORLD_SCALE, z * WORLD_SCALE, PLAYABLE_CLEAR[code] ?? 4)
  const runway: PtHash = new Map()
  if (b.airport.runway) addHashedRoad(runway, b.airport.runway, 60, 10)
  for (const line of b.rail) addHashedRoad(runway, line, 7, 6)

  const { roads: streets, dev } = streetGrid(b, mains, water, keep, runway)
  const roads = [...b.roads, ...streets]
  const allRoads: PtHash = new Map()
  for (const r of roads) addHashedRoad(allRoads, r.pts, roadW(r) / 2 + SIDEWALK_W)

  // 0) CBD high-rises take the middle of the blocks between Murtala
  //    Square, Ahmadu Bello Way and the river; tallest toward the core
  const towers: NonNullable<KadunaBake['towers']> = []
  {
    const trnd = seeded(0x70ad)
    const x0 = -185 * WORLD_SCALE
    const x1 = 70 * WORLD_SCALE
    const z0 = -95 * WORLD_SCALE
    const z1 = 160 * WORLD_SCALE
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    const span = Math.hypot(x1 - cx, z1 - cz)
    for (let i = Math.floor(x0 / BLOCK); i * BLOCK < x1; i++) {
      for (let j = Math.floor(z0 / BLOCK); j * BLOCK < z1; j++) {
        if (trnd() < 0.18) continue
        const x = (i + 0.5) * BLOCK + (trnd() - 0.5) * 6
        const z = (j + 0.5) * BLOCK + (trnd() - 0.5) * 6
        const w = 18 + trnd() * 12
        const d = 18 + trnd() * 10
        const r = Math.max(w, d) / 2 + 5
        if (hhit(allRoads, x, z, r, 0) || hhit(water, x, z, r, 6) || hhit(keep, x, z, r, 0) || hhit(keepHouses, x, z, r, 0) || hhit(runway, x, z, r, 0)) continue
        const centrality = 1 - Math.min(1, Math.hypot(x - cx, z - cz) / span)
        towers.push({ x, z, w, d, h: Math.round(30 + trnd() * 35 + centrality * 60), glass: trnd() < 0.62 })
      }
    }
  }
  const houses: PtHash = new Map()
  for (const t of towers) hput(houses, t.x, t.z, Math.max(t.w, t.d) / 2 + 5)
  const out: KadunaBake['houses'] = []
  let dropped = 0
  const fits = (x: number, z: number, r: number) =>
    !hhit(allRoads, x, z, r, 0.8) && !hhit(water, x, z, r, 0) && !hhit(keep, x, z, r, 0) && !hhit(keepHouses, x, z, r, 0) && !hhit(runway, x, z, r, 0) && !hhit(houses, x, z, r, 1.2)
  const rnd = seeded(0x1f1ad)

  // 0b) public buildings: schools + hospitals take whole blocks, filling
  //     stations and mechanic workshops front the main roads
  const civic: CivicSite[] = []
  const civicSolids: { x: number; z: number; w: number; d: number }[] = []
  {
    const crnd = seeded(0x5c401)
    const lw = (c: CivicSite, lx: number, lz: number): [number, number] => {
      const co = Math.cos(c.yaw)
      const si = Math.sin(c.yaw)
      return [c.x + lx * co + lz * si, c.z - lx * si + lz * co]
    }
    const solid = (c: CivicSite, lx: number, lz: number, w: number, d: number) => {
      const [x, z] = lw(c, lx, lz)
      const co = Math.abs(Math.cos(c.yaw))
      const si = Math.abs(Math.sin(c.yaw))
      civicSolids.push({ x, z, w: w * co + d * si, d: w * si + d * co })
    }
    const reserve = (c: CivicSite) => {
      // cover the lot with discs so no compound lands inside it
      const r = Math.min(c.w, c.d) / 2
      const nx = Math.max(1, Math.round(c.w / (r * 1.4)))
      const nz = Math.max(1, Math.round(c.d / (r * 1.4)))
      for (let a = 0; a < nx; a++) {
        for (let bb = 0; bb < nz; bb++) {
          const lx = (a + 0.5) / nx * c.w - c.w / 2
          const lz = (bb + 0.5) / nz * c.d - c.d / 2
          const [x, z] = lw(c, lx, lz)
          hput(houses, x, z, r * 0.75)
        }
      }
      civic.push(c)
    }
    const far = (kind: CivicKind, x: number, z: number, min: number) =>
      civic.every((c) => c.kind !== kind || Math.hypot(c.x - x, c.z - z) > min)
    const SCHOOLS = ['Government Secondary School', 'Capital School', 'Model Primary School', 'Kaduna Science Academy', 'Unity Girls College', 'Barnawa Primary School', 'Ahmadu Bello Memorial School', 'Arewa Comprehensive College']
    const HOSPITALS = ['General Hospital', 'Barau Dikko Teaching Hospital Annex', 'Yusuf Dantsoho Hospital', 'St. Gerard Clinic', 'Sabon Tasha Medical Centre', 'Kawo Specialist Hospital']
    const blocks = [...dev].map((k) => k.split(',').map(Number) as [number, number])
    blocks.sort((a, b2) => a[0] - b2[0] || a[1] - b2[1])
    for (let q = blocks.length - 1; q > 0; q--) {
      const r2 = Math.floor(crnd() * (q + 1))
      ;[blocks[q], blocks[r2]] = [blocks[r2], blocks[q]]
    }
    for (const [i, j] of blocks) {
      const x = (i + 0.5) * BLOCK
      const z = (j + 0.5) * BLOCK
      const inner = BLOCK - 2 * (roadWidth('residential') / 2 + SIDEWALK_W) - 3
      const r = inner / 2
      if (hhit(allRoads, x, z, r * 0.9, 0) || hhit(water, x, z, r, 0) || hhit(keep, x, z, r, 0) || hhit(keepHouses, x, z, r, 0) || hhit(runway, x, z, r, 0)) continue
      if (hhit(houses, x, z, r, 0)) continue // a CBD tower already lives here
      const h = crnd()
      let kind: CivicKind | null = null
      if (h < 0.05 && far('school', x, z, 650)) kind = 'school'
      else if (h < 0.075 && far('hospital', x, z, 1100)) kind = 'hospital'
      if (!kind) continue
      const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(crnd() * 4)]
      const names = kind === 'school' ? SCHOOLS : HOSPITALS
      const n = civic.filter((c) => c.kind === kind).length
      const c: CivicSite = { kind, x, z, w: inner, d: inner, yaw, name: names[n % names.length] }
      reserve(c)
      if (kind === 'school') {
        solid(c, -inner * 0.18, -inner * 0.28, inner * 0.55, 9)
        solid(c, inner * 0.3, inner * 0.05, 9, inner * 0.45)
      } else {
        solid(c, 0, -inner * 0.12, inner * 0.62, 17)
        solid(c, -inner * 0.32, inner * 0.18, 12, 14)
      }
      // perimeter wall with a gate in front
      const t = 0.4
      solid(c, 0, -inner / 2, inner, t)
      solid(c, -inner / 2, 0, t, inner)
      solid(c, inner / 2, 0, t, inner)
      const seg = (inner - 8) / 2
      solid(c, -inner / 2 + seg / 2, inner / 2, seg, t)
      solid(c, inner / 2 - seg / 2, inner / 2, seg, t)
    }
    // roadside businesses along the arterials
    let fuelN = 0
    let mechN = 0
    const FUEL = ['Arewa Petroleum', 'Zaria Road Fuels', 'Kaduna Energy', 'Gamji Oil', 'Sabon Gari Petrol']
    const MECH = ['Baba Sule Motors', 'Allah Ya Kiyaye Mechanic', 'Chidi Auto Repairs', 'Garba Vulcanizer', 'Danladi Panel Beater', 'Emeka Auto Electric']
    for (const r of b.roads) {
      if (r.class !== 'trunk' && r.class !== 'primary' && r.class !== 'secondary') continue
      const half = roadW(r) / 2 + SIDEWALK_W
      let acc = crnd() * 300
      for (let k = 0; k < r.pts.length - 1; k++) {
        const [ax, az] = r.pts[k]
        const [bx, bz] = r.pts[k + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 40) {
          acc += len
          continue
        }
        const fx = (bx - ax) / len
        const fz = (bz - az) / len
        for (let t = 20; t < len - 20; t += 25) {
          acc += 25
          const mid = Math.hypot(ax + fx * t, az + fz * t)
          if (mid > URBAN_R * 1.2) continue
          let kind: CivicKind | null = null
          if (acc > 560 && r.class !== 'secondary') kind = 'fuel'
          else if (acc > 300 && crnd() < 0.35) kind = 'mechanic'
          if (!kind) continue
          const side = crnd() < 0.5 ? 1 : -1
          const w = kind === 'fuel' ? 36 : 22
          const d = kind === 'fuel' ? 28 : 16
          const off = half + d / 2 + 1
          const x = ax + fx * t - fz * off * side
          const z = az + fz * t + fx * off * side
          const rr = Math.min(w, d) / 2
          if (hhit(allRoads, x, z, rr, 0.5) || hhit(water, x, z, rr, 0) || hhit(keep, x, z, rr, 0) || hhit(keepHouses, x, z, rr, 0) || hhit(runway, x, z, rr, 0) || hhit(houses, x, z, Math.max(w, d) / 2, 0)) continue
          const yaw = Math.atan2(fz * side, -fx * side)
          const c: CivicSite = { kind, x, z, w, d, yaw, name: kind === 'fuel' ? FUEL[fuelN++ % FUEL.length] : MECH[mechN++ % MECH.length] }
          reserve(c)
          if (kind === 'fuel') solid(c, 0, -d / 2 + 4.5, 12, 7)
          else solid(c, 0, -d / 2 + 2, w - 2, 1.2)
          acc = 0
        }
      }
    }
  }

  // 1) compounds fronting every street (main roads + the new grid)
  for (const r of roads) {
    const main = r.class === 'trunk' || r.class === 'primary'
    const half = roadW(r) / 2 + SIDEWALK_W
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 8) continue
      const fx = (bx - ax) / len
      const fz = (bz - az) / len
      const rot = Math.atan2(-fz, fx)
      const midR = Math.hypot((ax + bx) / 2, (az + bz) / 2)
      // open countryside along the highways far out of town
      if (main && midR > URBAN_R * 1.3 && rnd() < 0.85) continue
      for (const side of [-1, 1]) {
        let t = 4 + rnd() * 6
        while (t < len - 4) {
          const w = 12 + rnd() * 5
          const d = 11 + rnd() * 4
          const off = half + d / 2 + 1.2
          const cx = ax + fx * (t + w / 2) - fz * off * side
          const cz = az + fz * (t + w / 2) + fx * off * side
          const rr = Math.min(w, d) / 2
          if (rnd() > 0.08 && fits(cx, cz, rr)) {
            hput(houses, cx, cz, rr)
            out.push([+cx.toFixed(1), +cz.toFixed(1), +w.toFixed(1), +d.toFixed(1), +rot.toFixed(3), Math.floor(rnd() * 8), Math.floor(rnd() * 5)])
          }
          t += w + 1.5 + rnd() * 3
        }
      }
    }
  }
  const frontage = out.length
  // 2) the OSM-sampled houses that still fit (outlying villages, inner
  //    compounds) at modern footprints
  for (const h of b.houses) {
    const w = h[2] * 1.2
    const d = h[3] * 1.2
    const r = Math.min(w, d) / 2
    if (!fits(h[0], h[1], r)) {
      dropped++
      continue
    }
    hput(houses, h[0], h[1], r)
    out.push([h[0], h[1], +w.toFixed(1), +d.toFixed(1), h[4], h[5], h[6]])
  }
  if (typeof window === 'undefined' && (globalThis as any).process?.env?.KK_DEBUG) {
    console.log('[kaduna] civic', civic.map((c) => c.kind).join(' ').length, ['hospital', 'school', 'fuel', 'mechanic'].map((k) => k + ':' + civic.filter((c) => c.kind === k).length).join(' '), 'towers', towers.length, 'streets', streets.length, 'frontage', frontage, 'osm kept', out.length - frontage, 'dropped', dropped)
  }
  return { ...b, roads, houses: out, towers, civic, civicSolids }
}

export const BAKE = densify(scaleBake(bakeJson as unknown as KadunaBake))
export const WORLD = BAKE.meta.bounds

export function clampWorld(x: number, z: number): [number, number] {
  return [
    Math.max(WORLD.xmin, Math.min(WORLD.xmax, x)),
    Math.max(WORLD.zmin, Math.min(WORLD.zmax, z))
  ]
}

// friendly display names for bridges detected on the river
export const BRIDGE_NAMES: Record<string, string> = {
  'Junction Road': 'Coronation Bridge',
  "Umaru Musa Yar'adua Way": "Yar'adua Way Bridge",
  'Nnamdi Azikwe Way': 'Nnamdi Azikiwe Bridge'
}

export const PLAYABLE_POS: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(PLAYABLE_RAW).map(([k, v]) => [k, wp(v)])
)
