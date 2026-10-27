// Road graph + A* for the automatic commute.
//
// Every road polyline (OSM roads + the generated street grid) is sampled
// every ~10 m into nodes joined along the road; nodes of different roads
// that sit within LINK of each other are joined too (that is how crossings
// connect, since grid streets rarely share a vertex with the road they
// cross). Built once, on the first commute.
import { BAKE } from './kaduna'

const STEP = 10
const LINK = 8
const END_LINK = 18
const CELL = 16

interface Graph {
  x: Float32Array
  z: Float32Array
  adj: number[][]
  hash: Map<string, number[]>
}
let graph: Graph | null = null

const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`

function build(): Graph {
  const xs: number[] = []
  const zs: number[] = []
  const road: number[] = []
  const adj: number[][] = []
  BAKE.roads.forEach((r, ri) => {
    let prev = -1
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.ceil(len / STEP))
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const t = k / n
        const id = xs.length
        xs.push(ax + (bx - ax) * t)
        zs.push(az + (bz - az) * t)
        road.push(ri)
        adj.push([])
        if (prev >= 0) {
          adj[prev].push(id)
          adj[id].push(prev)
        }
        prev = id
      }
    }
  })
  const hash = new Map<string, number[]>()
  for (let i = 0; i < xs.length; i++) {
    const k = key(xs[i], zs[i])
    let a = hash.get(k)
    if (!a) hash.set(k, (a = []))
    a.push(i)
  }
  // crossings: link nearby nodes of different roads
  for (let i = 0; i < xs.length; i++) {
    const cx = Math.floor(xs[i] / CELL)
    const cz = Math.floor(zs[i] / CELL)
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const j of hash.get(`${cx + a},${cz + b}`) ?? []) {
          if (j <= i || road[j] === road[i]) continue
          if (Math.hypot(xs[i] - xs[j], zs[i] - zs[j]) < LINK) {
            adj[i].push(j)
            adj[j].push(i)
          }
        }
      }
    }
  }
  // T-junctions: a street often stops a few metres short of the road it
  // meets (the grid ends where the arterial's verge begins), so its end
  // node has no partner within LINK. Join each dead end to the nearest
  // node of another road within END_LINK (well under the river's width,
  // so this never invents a crossing).
  for (let i = 0; i < xs.length; i++) {
    if (adj[i].length > 1) continue
    let best = -1
    let bd = END_LINK
    const cx = Math.floor(xs[i] / CELL)
    const cz = Math.floor(zs[i] / CELL)
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        for (const j of hash.get(`${cx + a},${cz + b}`) ?? []) {
          if (road[j] === road[i]) continue
          const d = Math.hypot(xs[i] - xs[j], zs[i] - zs[j])
          if (d < bd) (bd = d), (best = j)
        }
      }
    }
    if (best >= 0 && !adj[i].includes(best)) {
      adj[i].push(best)
      adj[best].push(i)
    }
  }
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), adj, hash }
}

export function roadGraph(): Graph {
  return (graph ??= build())
}

/** nearest graph node to a point (searching outward ring by ring) */
export function nearestNode(px: number, pz: number, maxR = 400): number {
  const g = roadGraph()
  const cx = Math.floor(px / CELL)
  const cz = Math.floor(pz / CELL)
  let best = -1
  let bd = Infinity
  for (let r = 0; r * CELL <= maxR; r++) {
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue
        for (const i of g.hash.get(`${cx + a},${cz + b}`) ?? []) {
          const d = Math.hypot(g.x[i] - px, g.z[i] - pz)
          if (d < bd) (bd = d), (best = i)
        }
      }
    }
    if (best >= 0 && bd < r * CELL) break
  }
  return best
}

/** A* over the road graph; returns world points from `from` to `to`. */
export function findRoute(from: [number, number], to: [number, number]): [number, number][] {
  const g = roadGraph()
  const s = nearestNode(from[0], from[1])
  const t = nearestNode(to[0], to[1])
  if (s < 0 || t < 0) return [from, to]
  const n = g.x.length
  const gScore = new Float64Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const h = (i: number) => Math.hypot(g.x[i] - g.x[t], g.z[i] - g.z[t])
  // binary heap of [f, node]
  const heap: Array<[number, number]> = []
  const push = (f: number, i: number) => {
    heap.push([f, i])
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heap[p][0] <= heap[c][0]) break
      ;[heap[p], heap[c]] = [heap[c], heap[p]]
      c = p
    }
  }
  const pop = (): number => {
    const top = heap[0][1]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let c = 0
      for (;;) {
        const l = c * 2 + 1
        const r = l + 1
        let m = c
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === c) break
        ;[heap[m], heap[c]] = [heap[c], heap[m]]
        c = m
      }
    }
    return top
  }
  gScore[s] = 0
  push(h(s), s)
  while (heap.length) {
    const cur = pop()
    if (cur === t) break
    if (closed[cur]) continue
    closed[cur] = 1
    for (const nb of g.adj[cur]) {
      if (closed[nb]) continue
      const ng = gScore[cur] + Math.hypot(g.x[nb] - g.x[cur], g.z[nb] - g.z[cur])
      if (ng < gScore[nb]) {
        gScore[nb] = ng
        came[nb] = cur
        push(ng + h(nb), nb)
      }
    }
  }
  if (s !== t && came[t] < 0) return [from, to] // disconnected: straight line
  const path: [number, number][] = []
  for (let i = t; i >= 0; i = came[i]) {
    path.push([g.x[i], g.z[i]])
    if (i === s) break
  }
  path.reverse()
  return [from, ...path, to]
}

/** total length of a polyline */
export function pathLength(p: [number, number][]): number {
  let L = 0
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
  return L
}
