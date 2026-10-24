// Multi-storey homes: the upper floors of duplexes and blocks of flats,
// and the staircases that join them.
//
// All coordinates are the room's local frame (front door on +Z, W across,
// D deep), the same frame as utils/interiorRoom.ts. Floor L sits at
// y = L * FLOOR_H. Staircase L climbs from floor L to floor L+1 along the
// front wall: even flights on the left, odd flights on the right, so a
// flight never lands on top of the next one. Each flight starts near the
// middle of the room (the "bottom" end) and climbs towards a side wall,
// stopping short of it so there is a landing to step off onto upstairs.
import * as THREE from 'three'
import { box, cyl, rbox, merge, tileTex, woodTex, ankaraTex, rng, type BuiltRoom, type Hotspot, type LocalBox, type Part, type RoomWall } from '~/utils/interiorRoom'

export const FLOOR_H = 3.1
const WALL_H = 2.9
const T = 0.18
const BACK = 4.2
const SLAB = 0.2

export interface Stair {
  level: number
  /** -1 = left wall side, +1 = right */
  side: number
  /** x of the bottom and top ends (bottom near the middle of the room) */
  xb: number
  xt: number
  /** centre line z and width of the flight */
  zs: number
  sw: number
}

export function stairOf(W: number, D: number, level: number): Stair {
  const side = level % 2 === 0 ? -1 : 1
  return { level, side, xb: side * 1.35, xt: side * (W / 2 - 1.25), zs: D / 2 - 0.75, sw: 1.1 }
}

/** 0 at the bottom end, 1 at the top end (unclamped) */
export function stairT(s: Stair, lx: number): number {
  return (lx - s.xb) / (s.xt - s.xb)
}
export function onStairFootprint(s: Stair, lx: number, lz: number): boolean {
  const t = stairT(s, lx)
  return t >= 0 && t <= 1 && Math.abs(lz - s.zs) < s.sw / 2
}

/** The rail along the room side of a flight (on both floors it joins). */
function railBox(s: Stair): LocalBox {
  return { x: (s.xb + s.xt) / 2, z: s.zs - s.sw / 2 - 0.08, w: Math.abs(s.xt - s.xb), d: 0.12 }
}

/** Colliders on the floor the flight starts from: the side rail and the
 *  space under the top landing (a cupboard). */
export function stairLowerColliders(W: number, s: Stair): LocalBox[] {
  const inner = Math.abs(s.xt)
  const outer = W / 2
  return [railBox(s), { x: s.side * (inner + outer) / 2, z: s.zs, w: outer - inner, d: s.sw + 0.2 }]
}
/** Colliders on the floor the flight arrives at: rail round the stairwell,
 *  open only at the top end (the landing). */
export function stairUpperColliders(s: Stair): LocalBox[] {
  return [railBox(s), { x: s.xb - s.side * 0.06, z: s.zs, w: 0.12, d: s.sw + 0.2 }]
}
/** Colliders while you are on the flight itself. */
export function stairCorridor(s: Stair, D: number): LocalBox[] {
  return [railBox(s), { x: (s.xb + s.xt) / 2, z: D / 2, w: Math.abs(s.xt - s.xb) + 2, d: T + 0.1 }]
}

/** Steps, stringer and a timber handrail for flight L (in floor L's frame). */
export function buildStairs(s: Stair, tread: string, rail: string): THREE.Mesh {
  const n = Math.ceil(FLOOR_H / 0.19)
  const run = Math.abs(s.xt - s.xb)
  const step = run / n
  const P: Part[] = []
  for (let i = 0; i < n; i++) {
    const h = ((i + 1) / n) * FLOOR_H
    const x = s.xb + s.side * (i + 0.5) * step
    P.push([tread, box(step + 0.01, 0.06, s.sw, x, h - 0.03, s.zs)]) // tread
    P.push(['#d8d0c4', box(step + 0.01, h - 0.06, s.sw - 0.02, x, (h - 0.06) / 2, s.zs)]) // riser block
  }
  // handrail on the room side: posts + sloped rail
  const zr = s.zs - s.sw / 2 + 0.04
  for (let i = 0; i <= n; i += 3) {
    const x = s.xb + s.side * i * step
    const y0 = (i / n) * FLOOR_H
    P.push([rail, box(0.05, 0.9, 0.05, x, y0 + 0.45, zr)])
  }
  const len = Math.hypot(run, FLOOR_H)
  const ang = Math.atan2(FLOOR_H, run) * s.side
  const r = box(len, 0.06, 0.07, 0, 0, 0).rotateZ(ang).translate((s.xb + s.xt) / 2, FLOOR_H / 2 + 0.9, zr)
  P.push([rail, r])
  const mesh = new THREE.Mesh(merge(P), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** An upper floor: two bedrooms, a bathroom and a lounge, with the
 *  stairwell of the flight below cut out of the floor. */
export function buildUpperFloor(W: number, D: number, seed: number, level: number): BuiltRoom {
  const r = rng(seed * 7 + level * 131)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length) % a.length]!
  const group = new THREE.Group()
  const walls: RoomWall[] = []
  const colliders: LocalBox[] = []
  const disposables: Array<{ dispose: () => void }> = []
  const std = (o: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o })
    disposables.push(m)
    return m
  }
  const paint = pick(['#efe4d0', '#e4ece6', '#f2e6d8', '#e8e0ee', '#e6eadc', '#dfe8f0', '#f0dcd0'])
  const paintMat = std({ color: paint, roughness: 0.92 })
  const furnMat = std({ vertexColors: true, roughness: 0.7 })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = shadow
    m.receiveShadow = true
    group.add(m)
    disposables.push(geo)
    return m
  }
  const below = stairOf(W, D, level - 1)
  const backZ = -D / 2 + BACK

  // ---- floor slab with the stairwell cut out (also the ceiling below)
  const hx0 = Math.min(below.xb, below.xt)
  const hx1 = Math.max(below.xb, below.xt)
  const hz0 = below.zs - below.sw / 2
  const hz1 = below.zs + below.sw / 2
  const floorTex = level % 2 ? woodTex() : tileTex('#e8dcc4', '#b8ab92', 4, 'tile-main')
  const slab = (x0: number, x1: number, z0: number, z1: number) => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return
    const t = floorTex.clone()
    t.needsUpdate = true
    t.repeat.set((x1 - x0) / 2.2, (z1 - z0) / 2.2)
    disposables.push(t)
    add(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0.005, (z0 + z1) / 2), std({ map: t, roughness: 0.6 }), false)
    add(box(x1 - x0, SLAB, z1 - z0, (x0 + x1) / 2, -SLAB / 2, (z0 + z1) / 2), std({ color: '#cfc6b6' }), false)
  }
  slab(-W / 2, W / 2, -D / 2, hz0) // everything behind the stairwell
  slab(-W / 2, hx0, hz0, D / 2) // left of it
  slab(hx1, W / 2, hz0, D / 2) // right of it
  slab(hx0, hx1, hz1, D / 2) // the strip between the well and the front wall

  // ---- walls (same cut-away scheme as the ground floor)
  const wall = (len: number, along: 'x' | 'z', cx: number, cz: number, nx: number, nz: number, partition: boolean, gaps: Array<[number, number]> = [], windows: Array<[number, number]> = []) => {
    const h = partition ? 1.15 : WALL_H
    const holder = new THREE.Group()
    const segs: Array<[number, number]> = []
    let s0 = -len / 2
    for (const [g0, gw] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 - gw / 2 > s0) segs.push([s0, g0 - gw / 2])
      s0 = g0 + gw / 2
    }
    if (s0 < len / 2) segs.push([s0, len / 2])
    for (const [a, b] of segs) {
      const l = b - a
      const m = (a + b) / 2
      const g = along === 'x' ? box(l, h, T, m, h / 2, 0) : box(T, h, l, 0, h / 2, m)
      const mesh = new THREE.Mesh(g, paintMat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      holder.add(mesh)
      disposables.push(g)
      colliders.push(along === 'x' ? { x: cx + m, z: cz, w: l, d: T + 0.1 } : { x: cx, z: cz + m, w: T + 0.1, d: l })
    }
    for (const [wPos, wW] of windows) {
      const glass = along === 'x' ? box(wW, 1.15, 0.04, wPos, 1.65, -0.1 * nz) : box(0.04, 1.15, wW, -0.1 * nx, 1.65, wPos)
      const gm = new THREE.Mesh(glass, std({ color: '#cfe6f0', emissive: '#bfe0f0', emissiveIntensity: 0.6, roughness: 0.1 }))
      gm.userData.deco = true
      holder.add(gm)
      disposables.push(glass)
    }
    holder.position.set(cx, 0, cz)
    group.add(holder)
    walls.push({ mesh: holder, nx, nz, partition })
  }
  const bedW = 4.6
  const bathW = 2.4
  const xA1 = -W / 2 + bedW
  const xB0 = xA1 + bathW
  wall(W, 'x', 0, -D / 2, 0, -1, false, [], [[-W / 2 + bedW / 2, 1.5], [(xB0 + W / 2) / 2, 1.5]])
  wall(D, 'z', -W / 2, 0, -1, 0, false, [], [[(backZ + D / 2) / 2 - 1, 1.6]])
  wall(D, 'z', W / 2, 0, 1, 0, false, [], [[(backZ + D / 2) / 2 - 1, 1.6]])
  wall(W, 'x', 0, D / 2, 0, 1, false, [], [[0, 1.8]])
  wall(bedW, 'x', -W / 2 + bedW / 2, backZ, 0, 1, true, [[0.9, 1.3]])
  wall(bathW, 'x', xA1 + bathW / 2, backZ, 0, 1, true, [[0, 1.2]])
  wall(W / 2 - xB0, 'x', (xB0 + W / 2) / 2, backZ, 0, 1, true, [[-0.4, 1.3]])
  wall(BACK, 'z', xA1, -D / 2 + BACK / 2, 1, 0, true)
  wall(BACK, 'z', xB0, -D / 2 + BACK / 2, 1, 0, true)

  // ---- furniture
  const P: Part[] = []
  const G: Part[] = []
  const hotspots: Hotspot[] = []
  const bed = (bx: number, duvet: string) => {
    const bz = -D / 2 + 1.3
    P.push(['#6a4428', rbox(1.6, 1.1, 0.1, bx, 0.55, -D / 2 + T / 2 + 0.06, 0.04)])
    P.push(['#6a4428', box(1.6, 0.28, 2.1, bx, 0.2, bz + 0.05)])
    P.push(['#f4f2ec', rbox(1.5, 0.22, 2.0, bx, 0.45, bz + 0.05, 0.06)])
    P.push([duvet, rbox(1.56, 0.1, 1.35, bx, 0.58, bz + 0.4, 0.04)])
    P.push(['#f4f2ec', rbox(0.6, 0.14, 0.38, bx - 0.36, 0.62, -D / 2 + 0.45, 0.06)])
    P.push(['#f4f2ec', rbox(0.6, 0.14, 0.38, bx + 0.36, 0.62, -D / 2 + 0.45, 0.06)])
    colliders.push({ x: bx, z: bz, w: 1.7, d: 2.3 })
    hotspots.push({ id: 'bed', x: bx, z: bz + 1.55, fx: bx, fz: bz, seat: { x: bx, z: bz + 0.15, h: 0.52, yaw: 0 } })
  }
  bed(-W / 2 + 1.2, pick(['#3f7d8b', '#b8433a', '#3f6fae', '#d8a23c']))
  bed((xB0 + W / 2) / 2 + 0.3, pick(['#7a4a8a', '#2f7d5b', '#c06a3a', '#3f6fae']))
  // wardrobe in bedroom A
  P.push(['#7a5232', box(0.6, 2.0, 1.4, xA1 - 0.35, 1.0, -D / 2 + 1.2)])
  colliders.push({ x: xA1 - 0.35, z: -D / 2 + 1.2, w: 0.65, d: 1.45 })
  // bathroom: toilet, basin, shower tray
  const tx = xA1 + bathW / 2
  G.push(['#f4f4f2', rbox(0.42, 0.42, 0.6, tx - 0.55, 0.21, -D / 2 + 0.45, 0.1)])
  G.push(['#f4f4f2', rbox(0.44, 0.5, 0.18, tx - 0.55, 0.65, -D / 2 + 0.16, 0.05)])
  G.push(['#f4f4f2', rbox(0.5, 0.14, 0.4, tx + 0.55, 0.85, -D / 2 + 0.35, 0.05)])
  G.push(['#c8ccd2', cyl(0.02, 0.02, 0.8, tx + 0.55, 0.4, -D / 2 + 0.35, 8)])
  G.push(['#dfe8ea', box(0.95, 0.06, 0.95, tx + 0.2, 0.03, -D / 2 + BACK - 0.75)])
  G.push(['#c8ccd2', cyl(0.015, 0.015, 1.9, tx + 0.62, 0.95, -D / 2 + BACK - 1.15, 8)])
  const bathTex = tileTex('#e8f0f2', '#9ab0b8', 8, 'tile-bath').clone()
  bathTex.needsUpdate = true
  bathTex.repeat.set(bathW / 1.2, BACK / 1.2)
  disposables.push(bathTex)
  add(new THREE.PlaneGeometry(bathW, BACK).rotateX(-Math.PI / 2).translate(tx, 0.01, -D / 2 + BACK / 2), std({ map: bathTex, roughness: 0.4 }), false)
  colliders.push({ x: tx - 0.55, z: -D / 2 + 0.45, w: 0.5, d: 0.75 })
  colliders.push({ x: tx + 0.55, z: -D / 2 + 0.4, w: 0.55, d: 0.45 })
  hotspots.push({ id: 'toilet', x: tx - 0.55, z: -D / 2 + 1.2, fx: tx - 0.55, fz: -D / 2 + 0.5 })
  hotspots.push({ id: 'shower', x: tx + 0.1, z: -D / 2 + BACK - 0.75, fx: tx + 0.3, fz: -D / 2 + BACK - 0.7 })
  // lounge: sofa on the wall away from the stairwell, rug, coffee table, plant
  const lzMid = (backZ + D / 2) / 2 - 0.4
  const sofaSide = -below.side // opposite the stairwell
  const sx = sofaSide * (W / 2 - 0.6)
  const sofaCol = pick(['#4a5a72', '#7a3a3a', '#3f5a4a', '#8a7058', '#a85a3a'])
  P.push([sofaCol, rbox(0.85, 0.42, 2.4, sx, 0.21, lzMid, 0.08)])
  P.push([sofaCol, rbox(0.25, 0.75, 2.4, sx + sofaSide * 0.32, 0.5, lzMid, 0.08)])
  for (const z of [lzMid - 1.15, lzMid + 1.15]) P.push([sofaCol, rbox(0.85, 0.6, 0.2, sx, 0.3, z, 0.06)])
  colliders.push({ x: sx, z: lzMid, w: 1.0, d: 2.6 })
  hotspots.push({ id: 'sofa', x: sx - sofaSide * 0.95, z: lzMid, fx: sx, fz: lzMid, seat: { x: sx - sofaSide * 0.05, z: lzMid, h: 0.42, yaw: sofaSide > 0 ? -Math.PI / 2 : Math.PI / 2 } })
  const ctx = sx - sofaSide * 1.4
  P.push(['#6a4a2f', rbox(0.6, 0.06, 1.1, ctx, 0.42, lzMid, 0.03)])
  for (const [dx, dz] of [[-0.25, -0.48], [0.25, -0.48], [-0.25, 0.48], [0.25, 0.48]]) P.push(['#3a2a1a', box(0.04, 0.4, 0.04, ctx + dx, 0.2, lzMid + dz)])
  colliders.push({ x: ctx, z: lzMid, w: 0.65, d: 1.15 })
  const rugT = ankaraTex(seed + level, pick(['#f2c12e', '#d8473a', '#2f8a5b']), pick(['#1d1d20', '#7a2a1a', '#0e3a6a']), '#ffffff')
  add(new THREE.PlaneGeometry(2.0, 2.8).rotateX(-Math.PI / 2).translate(ctx + sofaSide * 0.3, 0.012, lzMid), std({ map: rugT, roughness: 0.95 }), false)
  P.push(['#a85a2a', cyl(0.16, 0.12, 0.32, sofaSide * (W / 2 - 0.45), 0.16, backZ + 0.55, 14)])
  P.push(['#2f6a3a', cyl(0.02, 0.32, 0.8, sofaSide * (W / 2 - 0.45), 0.7, backZ + 0.55, 8)])
  colliders.push({ x: sofaSide * (W / 2 - 0.45), z: backZ + 0.55, w: 0.4, d: 0.4 })
  add(merge(P), furnMat)
  if (G.length) add(merge(G), std({ vertexColors: true, roughness: 0.25, metalness: 0.1 }))

  // the stairwell from below: rail round it (open at the landing end)
  for (const b of stairUpperColliders(below)) colliders.push(b)
  const railMat = std({ color: '#5a3a22', roughness: 0.6 })
  const rb = railBox(below)
  add(box(rb.w, 0.06, 0.06, rb.x, 0.95, rb.z), railMat)
  for (let i = 0; i <= 4; i++) add(box(0.05, 0.95, 0.05, below.xb + (below.xt - below.xb) * (i / 4), 0.47, rb.z), railMat)
  add(box(0.06, 0.06, below.sw, below.xb - below.side * 0.06, 0.95, below.zs), railMat)

  // lights
  const lamp = new THREE.PointLight('#ffe2b8', 2.0, 16, 1.5)
  lamp.position.set(0, 2.6, lzMid)
  group.add(lamp)
  const bl = new THREE.PointLight('#ffd9a0', 1.0, 9, 1.6)
  bl.position.set(0, 2.2, -D / 2 + 1.5)
  group.add(bl)

  return {
    group,
    walls,
    colliders,
    hotspots,
    dispose() {
      for (const d of disposables) d.dispose()
      group.clear()
    }
  }
}

/** Storeys per house style (matches the exteriors in utils/housing.ts). */
export function levelsFor(type: string | undefined): number {
  return type === 'flats' ? 3 : type === 'duplex' || type === 'hipduplex' ? 2 : 1
}
