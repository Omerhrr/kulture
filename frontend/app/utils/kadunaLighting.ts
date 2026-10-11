// Deterministic city lighting + street furniture data derived from the
// baked OSM layout. Shared by the 3D renderer (KadunaCity + DayNight) and
// the pedestrian AI (crosswalks) so glow, geometry and behavior agree.
//
// Everything here is computed with fixed hashes, so it is stable across
// reloads without a bake step.

import { BAKE } from './kaduna'
import { hash01, hashDist, roadHash, houseHash, mulberry32 } from './kadunaExtras'

// ------------------------------------------------------------ nearest road
export interface RoadHit {
  x: number
  z: number
  fx: number
  fz: number
  rw: number
  dist: number
}

/** Closest point on the named road classes to (ax, az), with road tangent. */
export function nearestRoadPoint(
  ax: number,
  az: number,
  classes: string[] = ['trunk', 'primary'],
  maxDist = 240
): RoadHit | null {
  let best: RoadHit | null = null
  for (const r of BAKE.roads) {
    if (!classes.includes(r.class) || r.pts.length < 2) continue
    const rw = r.class === 'trunk' ? 3.2 : r.class === 'primary' ? 2.6 : 1.8
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [px, pz] = r.pts[i]
      const [qx, qz] = r.pts[i + 1]
      const dx = qx - px
      const dz = qz - pz
      const len2 = dx * dx + dz * dz || 1
      let t = ((ax - px) * dx + (az - pz) * dz) / len2
      t = Math.max(0, Math.min(1, t))
      const cx = px + dx * t
      const cz = pz + dz * t
      const d = Math.hypot(cx - ax, cz - az)
      if (d < (best?.dist ?? Infinity)) {
        const len = Math.sqrt(len2) || 1
        best = { x: cx, z: cz, fx: dx / len, fz: dz / len, rw, dist: d }
      }
    }
  }
  if (best && best.dist > maxDist) return null
  return best
}

// ------------------------------------------------------------ streetlights
export interface StreetLamp {
  x: number
  y: number
  z: number
  /** arm direction (unit, pointing from pole toward the road) */
  ax: number
  az: number
}

const lampList: StreetLamp[] | null = null

/** Streetlight head positions; mirrors the KadunaCity pole loop exactly. */
export function streetlights(): StreetLamp[] {
  if (lampList) return lampList
  const out: StreetLamp[] = []
  const roadWidth = (cls: string) => (cls === 'trunk' ? 3.2 : cls === 'primary' ? 2.6 : 1.8)
  for (const r of BAKE.roads) {
    if (r.class !== 'primary' && r.class !== 'trunk') continue
    const rw = roadWidth(r.class)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const segLen = Math.hypot(bx - ax, bz - az)
      const n = Math.floor(segLen / 44)
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        const fx = (bx - ax) / (segLen || 1)
        const fz = (bz - az) / (segLen || 1)
        const ox = -fz * (rw / 2 + 0.9)
        const oz = fx * (rw / 2 + 0.9)
        // head sits at the end of the arm reaching back over the road
        out.push({
          x: x + ox + fz * 1.4,
          y: 4.5,
          z: z + oz - fx * 1.4,
          ax: -fz,
          az: fx
        })
      }
    }
  }
  return out
}

// ------------------------------------------------------------ window glow
export interface GlowQuad {
  /** center */
  x: number
  y: number
  z: number
  /** half extents: right vector (rx, rz) and up is always (0, 1) */
  rx: number
  rz: number
  h: number
  color: string
}

const GLOW_COLORS = ['#ffd98a', '#ffe9b8', '#ffedc4', '#cfe4ff', '#ffcf7a']

/**
 * Warm window quads for every house (placed exactly on the window boxes the
 * city renderer draws) + a lamp quad over many doors. Rendered by one
 * unlit merged mesh whose opacity follows the night factor.
 */
export function windowLights(): { quads: GlowQuad[]; lit: Float32Array } {
  const quads: GlowQuad[] = []
  const lit: number[] = []
  const nWalls = 10
  const addQuad = (x: number, y: number, z: number, rx: number, rz: number, h: number, color: string, on: number) => {
    quads.push({ x, y, z, rx, rz, h, color })
    lit.push(on)
  }
  for (const [x, z, w, d, rot, ci] of BAKE.houses) {
    const h1 = hash01(x, z)
    const h2 = hash01(x, z, 11)
    const h3 = hash01(x, z, 23)
    const twoStory = h1 < 0.26
    const hh = twoStory ? 6.0 : 3.4 + (ci % 3) * 0.35
    const winY = twoStory ? 4.6 : 1.9
    const cr = Math.cos(rot)
    const sr = Math.sin(rot)
    // local tangent for a window on the +/-x flanks runs along local z
    const tzx = sr
    const tzz = cr
    const txX = cr // local x axis in world
    const txZ = -sr
    const pushWin = (lx: number, lz: number, nx: number, nz: number, along: number) => {
      // face center in world, pushed just past the window box's outer face
      const out = 0.09
      const wx = x + (lx + nx * out) * cr + lz * sr
      const wz = z - (lx + nx * out) * sr + lz * cr
      // lit probability: evening routine, most houses glow at night
      const r = hash01(x * 1.7 + lx, z * 1.3 + lz, 41)
      const on = r < 0.62 ? 1 : 0
      const color = GLOW_COLORS[Math.floor(hash01(x, z + lz, 55) * GLOW_COLORS.length)]
      // quad spans "along" on the window plane and 1.1 vertical:
      // flank windows (normal along x) run along local z, others along x
      const rx = nx === 0 ? txX : tzx
      const rz = nx === 0 ? txZ : tzz
      addQuad(wx, winY, wz, (rx * along) / 2, (rz * along) / 2, 0.52, color, on)
      void nz
    }
    // flank windows (match KadunaCity: 1.0 wide, 1.1 tall)
    pushWin(-(w / 2 + 0.08), d / 6, -1, 0, 1.0)
    pushWin(w / 2 + 0.08, -d / 6, 1, 0, 1.0)
    if (twoStory) {
      // upstairs windows on both flanks
      pushWin(-(w / 2 + 0.08), -d / 6, -1, 0, 1.0)
      pushWin(w / 2 + 0.08, d / 6, 1, 0, 1.0)
    }
    // door lamp: warm glow over the entrance for a third of homes
    if (h3 > 0.62) {
      const [dnx, dnz] = doorSide(x, z)
      const lx = dnx * (w / 2 + 0.35)
      const lz = dnz * (d / 2 + 0.35)
      const wx = x + lx * cr + lz * sr
      const wz = z - lx * sr + lz * cr
      // door on an x flank spans local z; on a z face it spans local x
      const rx = dnx !== 0 ? tzx : txX
      const rz = dnx !== 0 ? tzz : txZ
      addQuad(wx, 2.75, wz, rx * 0.4, rz * 0.4, 0.24, '#ffd98a', 1)
    }
    void hh
    void h2
    void nWalls
  }
  return { quads, lit: new Float32Array(lit) }
}

function doorSide(x: number, z: number): [number, number] {
  const d = hashDist(roadHash(), x, z, 60)
  if (d > 58) return [0, 1]
  let best: [number, number] = [0, 1]
  let bestD = Infinity
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const dd = hashDist(roadHash(), x + dx * (6 + hash01(x, z, 5) * 2), z + dz * (6 + hash01(z, x, 5) * 2), 30)
    if (dd < bestD) {
      bestD = dd
      best = [dx, dz]
    }
  }
  return best
}

// ------------------------------------------------------------ crosswalks
export interface Crosswalk {
  x: number
  z: number
  /** road direction (stripes align with this) */
  fx: number
  fz: number
  /** perpendicular (pedestrian walk direction) */
  nx: number
  nz: number
  rw: number
}

let crosswalkCache: Crosswalk[] | null = null

/**
 * Zebra crossings: market front, Murtala Square approach, the spawn street,
 * the keke stop approach and the CBD. Placed on the nearest primary road to
 * each anchor, nudged off intersections.
 */
export function crosswalks(): Crosswalk[] {
  if (crosswalkCache) return crosswalkCache
  const anchors: Array<[number, number]> = [
    [-80, 102], // Kaduna Central Market
    [0, 26], // Murtala Square approach
    [-98, 40], // the player's street
    [-245, 420], // keke stop
    [-46, 56], // CBD crossing
    [114, 151] // KASU side
  ]
  const out: Crosswalk[] = []
  for (const [ax, az] of anchors) {
    const hit = nearestRoadPoint(ax, az, ['trunk', 'primary'])
    if (!hit || hit.dist > 120) continue
    out.push({
      x: hit.x,
      z: hit.z,
      fx: hit.fx,
      fz: hit.fz,
      nx: -hit.fz,
      nz: hit.fx,
      rw: hit.rw
    })
  }
  crosswalkCache = out
  return out
}

// ------------------------------------------------------------ traffic signals
export interface Signal {
  x: number
  z: number
  /** road direction controlled */
  fx: number
  fz: number
  /** pole position (road edge) */
  px: number
  pz: number
  /** phase offset seconds */
  offset: number
}

let signalCache: Signal[] | null = null

/** Traffic signals: market front, the square, and the keke stop road. */
export function signals(): Signal[] {
  if (signalCache) return signalCache
  const anchors: Array<[number, number, number]> = [
    [-80, 102, 0],
    [0, 0, 7],
    [-245, 420, 14],
    [-60, 210, 4]
  ]
  const out: Signal[] = []
  for (const [ax, az, offset] of anchors) {
    const hit = nearestRoadPoint(ax, az, ['trunk', 'primary'])
    if (!hit || hit.dist > 130) continue
    out.push({
      x: hit.x,
      z: hit.z,
      fx: hit.fx,
      fz: hit.fz,
      px: hit.x + -hit.fz * (hit.rw / 2 + 1.1),
      pz: hit.z + hit.fx * (hit.rw / 2 + 1.1),
      offset
    })
  }
  signalCache = out
  return out
}

/** Signal light cycle: 14s green, 2.5s amber, 13s red (29.5s total). */
export type SignalColor = 'green' | 'amber' | 'red'
export const SIGNAL_CYCLE = 29.5
export function signalPhase(signal: Signal, tSec: number): SignalColor {
  const t = ((tSec + signal.offset) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE
  if (t < 14) return 'green'
  if (t < 16.5) return 'amber'
  return 'red'
}

// ------------------------------------------------------------ road medians
export interface Median {
  pts: Array<[number, number]>
}

/**
 * Kaduna's main roads are mapped as twin one way carriageways. This finds
 * the twins (same road name, centerlines within 14 units) and returns the
 * median line between each pair so the renderer can draw a raised island.
 */
let medianCache: Median[] | null = null
export function roadMedians(): Median[] {
  if (medianCache) return medianCache
  const mains = BAKE.roads.filter((r) => r.class === 'primary' || r.class === 'trunk')
  const used = new Set<number>()
  const out: Median[] = []
  for (let i = 0; i < mains.length; i++) {
    if (used.has(i)) continue
    const a = mains[i]
    let twin = -1
    let twinD = Infinity
    for (let j = i + 1; j < mains.length; j++) {
      if (used.has(j) || mains[j].name !== a.name) continue
      const b0 = mains[j].pts[0]
      const bEnd = mains[j].pts[mains[j].pts.length - 1]
      // twins may be mapped in the same or the opposite direction
      const d = Math.min(
        Math.hypot(b0[0] - a.pts[0][0], b0[1] - a.pts[0][1]),
        Math.hypot(bEnd[0] - a.pts[0][0], bEnd[1] - a.pts[0][1])
      )
      if (d < twinD) {
        twinD = d
        twin = j
      }
    }
    if (twin < 0 || twinD > 26) continue
    used.add(i)
    used.add(twin)
    const b = mains[twin]
    // walk a, project onto b, keep midpoints where the pair is close
    const pts: Array<[number, number]> = []
    let last: [number, number] | null = null
    for (let s = 0; s < a.pts.length - 1; s++) {
      const [ax, az] = a.pts[s]
      const [bx, bz] = a.pts[s + 1]
      const segLen = Math.hypot(bx - ax, bz - az) || 1
      const steps = Math.max(1, Math.floor(segLen / 12))
      for (let k = 0; k < steps; k++) {
        const t = k / steps
        const px = ax + (bx - ax) * t
        const pz = az + (bz - az) * t
        // nearest point on b
        let best: [number, number] | null = null
        let bestD = Infinity
        for (let u = 0; u < b.pts.length - 1; u++) {
          const [cx, cz] = b.pts[u]
          const [dx, dz] = b.pts[u + 1]
          const ex = dx - cx
          const ez = dz - cz
          const len2 = ex * ex + ez * ez || 1
          let tt = ((px - cx) * ex + (pz - cz) * ez) / len2
          tt = Math.max(0, Math.min(1, tt))
          const qx = cx + ex * tt
          const qz = cz + ez * tt
          const d = Math.hypot(qx - px, qz - pz)
          if (d < bestD) {
            bestD = d
            best = [qx, qz]
          }
        }
        if (!best || bestD > 14) continue
        const m: [number, number] = [(px + best[0]) / 2, (pz + best[1]) / 2]
        if (last && Math.hypot(m[0] - last[0], m[1] - last[1]) > 26) {
          if (pts.length > 1) out.push({ pts: pts.slice() })
          pts.length = 0
        }
        pts.push(m)
        last = m
      }
    }
    if (pts.length > 1) out.push({ pts: pts.slice() })
  }
  medianCache = out
  return out
}

// ------------------------------------------------------------ market zone
/** The market congestion zone the traffic system respects. */
export function marketFront(): { x: number; z: number; r: number } {
  const m = BAKE.landmarks.find((l) => l.kind === 'market')
  if (m) return { x: m.x, z: m.z + 30, r: 34 }
  return { x: -80, z: 132, r: 34 }
}

// ------------------------------------------------------------ determinism
/** Seeded rng for behavior that must match between systems. */
export function cityRng(seed: number) {
  return mulberry32(seed)
}

/** Is this world point close to a building wall (used by peds to keep off). */
export function nearHouse(x: number, z: number, r: number): boolean {
  return hashDist(houseHash(), x, z, r + 2) < r
}
