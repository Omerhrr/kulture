// Street-race routes on real Kaduna roads (the OSM bake). Each route takes
// the longest continuous stretch of a named road and drops a checkpoint
// every ~CP_GAP metres along it. Route ids match the backend (/races).
import { BAKE } from '~/utils/kaduna'
import { findRoute } from '~/utils/roadGraph'
import { hashDist, roadHash } from '~/utils/kadunaExtras'
import { IS_CITY } from '~/utils/kaduna'
import { REGION_ID, regionById } from '~/utils/regions'

export interface RaceRoute {
  id: string
  name: string
  road: string
  night?: boolean
  cps: [number, number][]
  length: number
}

// `road`: follow that named road; `from`/`to`: landmark keys joined by the
// shortest drive over the real road graph
type Def = { id: string; name: string; road: string; from?: string; to?: string; night?: boolean; maxLen: number }
/** Routes in the other towns: the town's longest highway + a market dash. */
function townDefs(): Def[] {
  const town = regionById(REGION_ID).name
  const named = [...new Set(BAKE.roads.filter((r) => r.name && r.class !== 'residential').map((r) => r.name))]
  const longest = named.sort((a, b) => polyLen(chains(b).sort((x, y) => polyLen(y) - polyLen(x))[0] ?? []) - polyLen(chains(a).sort((x, y) => polyLen(y) - polyLen(x))[0] ?? []))[0] ?? ''
  const key = (...kinds: string[]) => BAKE.landmarks.find((l) => kinds.includes(l.kind))?.key
  return [
    { id: `${REGION_ID}_sprint`, name: `${town} Highway Sprint`, road: longest, maxLen: 2600 },
    { id: `${REGION_ID}_dash`, name: `${town} Market Dash`, road: longest, from: key('market'), to: key('motorpark', 'station', 'junction', 'campus', 'hospital'), night: true, maxLen: 2200 }
  ]
}
const CITY_DEFS: Def[] = [
  { id: 'ahmadu_bello_sprint', name: 'Ahmadu Bello Way Sprint', road: 'Ahmadu Bello Way', from: 'murtala_square', to: 'kawo_park', maxLen: 2600 },
  { id: 'bridge_dash', name: 'River Kaduna Bridge Dash', road: 'Junction Road', from: 'kaduna_junction', to: 'central_market', maxLen: 2200 },
  { id: 'barnawa_loop', name: 'Kachia Road Night Run', road: 'Kachia Road', night: true, maxLen: 3800 }
]
const CP_GAP = 160

function polyLen(pts: [number, number][]) {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
  return L
}

/** Join the pieces of a named road end-to-end where they touch. */
function chains(name: string): [number, number][][] {
  const pieces = BAKE.roads.filter((r) => r.name === name).map((r) => r.pts.map((p) => [p[0], p[1]] as [number, number]))
  const out: [number, number][][] = []
  const used = new Set<number>()
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 14
  for (let i = 0; i < pieces.length; i++) {
    if (used.has(i)) continue
    used.add(i)
    let ch = [...pieces[i]!]
    let grew = true
    while (grew) {
      grew = false
      for (let j = 0; j < pieces.length; j++) {
        if (used.has(j)) continue
        const p = pieces[j]!
        if (near(ch[ch.length - 1]!, p[0]!)) ch = [...ch, ...p.slice(1)]
        else if (near(ch[ch.length - 1]!, p[p.length - 1]!)) ch = [...ch, ...[...p].reverse().slice(1)]
        else if (near(ch[0]!, p[p.length - 1]!)) ch = [...p.slice(0, -1), ...ch]
        else if (near(ch[0]!, p[0]!)) ch = [...[...p].reverse().slice(0, -1), ...ch]
        else continue
        used.add(j)
        grew = true
      }
    }
    out.push(ch)
  }
  return out
}

function resample(pts: [number, number][], gap: number, maxLen: number): { cps: [number, number][]; length: number } {
  const cps: [number, number][] = [pts[0]!]
  let carry = 0
  let total = 0
  for (let i = 1; i < pts.length && total < maxLen; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    let t = gap - carry
    while (t <= seg && total + t - carry < maxLen) {
      cps.push([a[0] + ((b[0] - a[0]) * t) / seg, a[1] + ((b[1] - a[1]) * t) / seg])
      t += gap
    }
    carry = (carry + seg) % gap
    total += seg
  }
  return { cps, length: Math.min(total, maxLen) }
}

let cache: RaceRoute[] | null = null
export function raceRoutes(): RaceRoute[] {
  if (cache) return cache
  const DEFS = IS_CITY ? CITY_DEFS : townDefs()
  cache = DEFS.map((d) => {
    let ch: [number, number][] = []
    const a = BAKE.landmarks.find((l) => l.key === d.from)
    const b = BAKE.landmarks.find((l) => l.key === d.to)
    if (a && b) ch = findRoute([a.x, a.z], [b.x, b.z])
    if (polyLen(ch) < 800) ch = chains(d.road).sort((x, y) => polyLen(y) - polyLen(x))[0] ?? []
    // start (and finish) on the tarmac, not on the grass of a square
    while (ch.length > 2 && hashDist(roadHash(), ch[0]![0], ch[0]![1], 40) > 5) ch = ch.slice(1)
    while (ch.length > 2 && hashDist(roadHash(), ch[ch.length - 1]![0], ch[ch.length - 1]![1], 40) > 5) ch = ch.slice(0, -1)
    const { cps } = resample(ch, CP_GAP, d.maxLen)
    return { id: d.id, name: d.name, road: d.road, night: d.night, cps, length: polyLen(cps) }
  }).filter((r) => r.cps.length >= 4)
  return cache
}

export interface RaceState {
  phase: 'idle' | 'travel' | 'board' | 'countdown' | 'racing' | 'done'
  route: string | null
  name: string
  cp: number
  total: number
  startAt: number
  ms: number
  position: number
  result: any
  /** other real players racing this route right now */
  live?: Array<{ name: string; cp: number; ms: number; finished: boolean; ready: boolean }>
}
