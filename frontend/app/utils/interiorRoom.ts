// Furnished home interiors, built for a cut-away (doll's house) camera:
// the walls on the camera's side drop to a low stub so you look down into
// the home like a life sim, the far walls stay full height with windows,
// curtains and wall art.
//
// Layout (local frame, front door on +Z, W across, D deep):
//   back strip  : bedroom | bathroom | open kitchen
//   front zone  : living room (sofa, armchairs, TV wall, rug) + dining set
// Every surface has a real material (ceramic floor tiles, wood planks,
// bathroom tiles, painted walls with skirting) and upholstered furniture
// uses rounded geometry. Each home is decorated from its own seed.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export interface RoomWall {
  mesh: THREE.Object3D
  /** outward normal in local space (x, z) */
  nx: number
  nz: number
  /** low partition walls never cut away further */
  partition: boolean
}
export interface LocalBox {
  x: number
  z: number
  w: number
  d: number
}
/** A spot where the player can stand and use something (local coords). */
export interface Hotspot {
  id: 'fridge' | 'cooker' | 'bed' | 'tv' | 'toilet' | 'shower' | 'sofa' | 'dining' | 'chair'
  x: number
  z: number
  /** where the object is (the player turns to face it) */
  fx: number
  fz: number
  /** sit / lie ON the furniture: body position, surface height, yaw */
  seat?: { x: number; z: number; h: number; yaw: number }
}
export interface BuiltRoom {
  group: THREE.Group
  walls: RoomWall[]
  colliders: LocalBox[]
  hotspots: Hotspot[]
  dispose: () => void
}

const WALL_H = 2.9
const T = 0.18
const BACK = 4.2 // depth of the bedroom / bath / kitchen strip

// ------------------------------------------------------------- textures
const texCache = new Map<string, THREE.Texture>()
export function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.Texture {
  const hit = texCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  draw(g, size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  texCache.set(key, t)
  return t
}
export function rng(seed: number) {
  let a = Math.floor(seed * 9973) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const tileTex = (base: string, grout: string, n: number, key: string) =>
  canvasTex(key, 256, (g, s) => {
    const r = rng(n)
    const cell = s / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 0.94 + r() * 0.08
        const c = new THREE.Color(base).multiplyScalar(v)
        g.fillStyle = `#${c.getHexString()}`
        g.fillRect(i * cell, j * cell, cell, cell)
        // soft marble veins
        g.strokeStyle = 'rgba(120,110,95,0.10)'
        g.beginPath()
        g.moveTo(i * cell + r() * cell, j * cell)
        g.bezierCurveTo(i * cell + r() * cell, j * cell + cell * 0.4, i * cell + r() * cell, j * cell + cell * 0.6, i * cell + r() * cell, j * cell + cell)
        g.stroke()
      }
    }
    g.fillStyle = grout
    for (let i = 0; i <= n; i++) {
      g.fillRect(i * cell - 1, 0, 2, s)
      g.fillRect(0, i * cell - 1, s, 2)
    }
  })
export const woodTex = () =>
  canvasTex('wood', 256, (g, s) => {
    const r = rng(7)
    const plank = s / 6
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Color('#9a6a42').multiplyScalar(0.85 + r() * 0.3)
      g.fillStyle = `#${c.getHexString()}`
      g.fillRect(0, i * plank, s, plank)
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(60,35,15,${0.08 + r() * 0.1})`
        g.beginPath()
        const y = i * plank + r() * plank
        g.moveTo(0, y)
        g.bezierCurveTo(s * 0.3, y + r() * 4 - 2, s * 0.6, y + r() * 4 - 2, s, y)
        g.stroke()
      }
      g.fillStyle = 'rgba(40,25,10,0.5)'
      g.fillRect(0, i * plank, s, 1.5)
      g.fillRect(((i * 97) % 5) * (s / 5), i * plank, 1.5, plank)
    }
  })
export const ankaraTex = (seed: number, a: string, b: string, c: string) =>
  canvasTex(`ankara-${a}-${b}-${c}`, 256, (g, s) => {
    g.fillStyle = a
    g.fillRect(0, 0, s, s)
    const n = 6
    const cell = s / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = i * cell + cell / 2
        const cy = j * cell + cell / 2
        g.fillStyle = (i + j) % 2 ? b : c
        g.beginPath()
        g.moveTo(cx, cy - cell * 0.42)
        g.lineTo(cx + cell * 0.42, cy)
        g.lineTo(cx, cy + cell * 0.42)
        g.lineTo(cx - cell * 0.42, cy)
        g.closePath()
        g.fill()
        g.fillStyle = a
        g.beginPath()
        g.arc(cx, cy, cell * 0.14, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.strokeStyle = b
    g.lineWidth = 10
    g.strokeRect(5, 5, s - 10, s - 10)
    void seed
  })
const artTex = (seed: number) =>
  canvasTex(`art-${Math.floor(seed * 7) % 7}`, 128, (g, s) => {
    const r = rng(seed + 3)
    const sky = ['#f0b060', '#7ab0d0', '#e07a50', '#a0c890'][Math.floor(r() * 4)]
    const grd = g.createLinearGradient(0, 0, 0, s)
    grd.addColorStop(0, sky)
    grd.addColorStop(1, '#f4e6c8')
    g.fillStyle = grd
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#5a4030'
    g.beginPath()
    g.moveTo(0, s * 0.75)
    for (let x = 0; x <= s; x += 8) g.lineTo(x, s * 0.7 - Math.sin(x * 0.05 + r() * 2) * 10)
    g.lineTo(s, s)
    g.lineTo(0, s)
    g.fill()
    g.fillStyle = '#2f4a2a'
    g.fillRect(s * 0.62, s * 0.4, 4, s * 0.3)
    g.beginPath()
    g.arc(s * 0.63, s * 0.38, 16, 0, Math.PI * 2)
    g.fill()
  })
export const screenTex = () =>
  canvasTex('tv', 128, (g, s) => {
    const grd = g.createLinearGradient(0, 0, 0, s)
    grd.addColorStop(0, '#2a6ab0')
    grd.addColorStop(1, '#1c3a60')
    g.fillStyle = grd
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#3fa04a' // football pitch
    g.fillRect(0, s * 0.45, s, s * 0.55)
    g.strokeStyle = 'rgba(255,255,255,0.7)'
    g.lineWidth = 2
    g.strokeRect(10, s * 0.52, s - 20, s * 0.4)
    g.fillStyle = '#ffffff'
    g.fillRect(8, 8, 46, 14)
    g.fillStyle = '#d8262e'
    g.fillRect(8, 8, 10, 14)
  })

// ------------------------------------------------------------- builder
export type Part = [string, THREE.BufferGeometry]
export function merge(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(([hex, g]) => {
    let gg = g.index ? g.toNonIndexed() : g
    if (gg !== g) g.dispose()
    gg = gg.clone()
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k)
    const c = new THREE.Color(hex)
    const n = gg.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    gg.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return gg
  })
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const pos = new Float32Array(total * 3)
  const nrm = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  let off = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, off)
    nrm.set(g.attributes.normal.array as Float32Array, off)
    col.set(g.attributes.color.array as Float32Array, off)
    off += g.attributes.position.count * 3
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  out.computeBoundingSphere()
  return out
}

export const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
export const rbox = (w: number, h: number, d: number, x: number, y: number, z: number, r = 0.06) =>
  new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)).translate(x, y, z)
export const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z)
export const sph = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, y, z)
/** rotate a geometry around Y then place it */
export const rotY = (g: THREE.BufferGeometry, a: number, x: number, z: number) => g.rotateY(a).translate(x, 0, z)

export function buildRoom(W: number, D: number, seed: number, opts: { customFurniture?: boolean } = {}): BuiltRoom {
  const custom = !!opts.customFurniture
  const r = rng(seed)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length) % a.length]
  const group = new THREE.Group()
  const walls: RoomWall[] = []
  const colliders: LocalBox[] = []
  const disposables: Array<{ dispose: () => void }> = []

  const paint = pick(['#efe4d0', '#e4ece6', '#f2e6d8', '#e8e0ee', '#e6eadc', '#f4ead6', '#dfe8f0', '#f0dcd0', '#e0e8d0', '#d8d0c4', '#c8dce0'])
  const accent = pick(['#3f6a8a', '#8a4a3a', '#3f7a5a', '#b8863a', '#6a4a7a'])
  const sofaCol = pick(['#4a5a72', '#7a3a3a', '#3f5a4a', '#8a7058', '#3a3a44', '#a85a3a'])
  const duvet = pick(['#3f7d8b', '#b8433a', '#3f6fae', '#d8a23c', '#7a4a8a', '#2f7d5b'])
  const rugTex = ankaraTex(seed, pick(['#f2c12e', '#d8473a', '#2f8a5b', '#1f4fa0']), pick(['#1d1d20', '#7a2a1a', '#0e3a6a']), pick(['#ffffff', '#f2c12e', '#e8732a']))

  const std = (o: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o })
    disposables.push(m)
    return m
  }
  const paintMat = std({ color: paint, roughness: 0.92 })
  const accentMat = std({ color: accent, roughness: 0.9 })
  const furnMat = std({ vertexColors: true, roughness: 0.7 })
  const glossMat = std({ vertexColors: true, roughness: 0.25, metalness: 0.1 })

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = shadow
    m.receiveShadow = true
    group.add(m)
    disposables.push(geo)
    return m
  }
  const floor = (w: number, d: number, x: number, z: number, tex: THREE.Texture, rep: number) => {
    const t = tex.clone()
    t.needsUpdate = true
    t.repeat.set(w / rep, d / rep)
    disposables.push(t)
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0.005, z)
    add(g, std({ map: t, roughness: 0.55 }), false)
  }

  // ---------------------------------------------------------- floors
  const backZ = -D / 2 + BACK
  const bedW = 4.6
  const bathW = 2.4
  const xBed1 = -W / 2 + bedW
  const xBath1 = xBed1 + bathW
  // living floor: every home picks its own finish
  const finish = Math.floor(r() * 5)
  const mainFloor =
    finish === 0
      ? tileTex('#e8dcc4', '#b8ab92', 4, 'tile-main')
      : finish === 1
        ? woodTex()
        : finish === 2
          ? tileTex('#d8d4cc', '#8a8680', 3, 'tile-grey')
          : finish === 3
            ? tileTex('#c9a27a', '#8a6a4a', 5, 'tile-terracotta')
            : tileTex('#f2efe8', '#c8c2b4', 2, 'tile-marble')
  floor(W, D - BACK, 0, (backZ + D / 2) / 2, mainFloor, finish === 1 ? 2.2 : 2.4)
  floor(bedW, BACK, -W / 2 + bedW / 2, -D / 2 + BACK / 2, woodTex(), 2.2)
  floor(bathW, BACK, xBed1 + bathW / 2, -D / 2 + BACK / 2, tileTex('#e8f0f2', '#9ab0b8', 8, 'tile-bath'), 1.2)
  floor(W / 2 - xBath1, BACK, (xBath1 + W / 2) / 2, -D / 2 + BACK / 2, tileTex('#d8d0c0', '#8a8070', 6, 'tile-kitchen'), 1.5)
  // slab under everything (no gaps at the edges)
  add(box(W + 0.4, 0.2, D + 0.4, 0, -0.1, 0), std({ color: '#6a6458' }), false)

  // ---------------------------------------------------------- walls
  // each wall is its own mesh so the camera side can be cut away
  const wall = (len: number, along: 'x' | 'z', cx: number, cz: number, nx: number, nz: number, partition: boolean, gaps: Array<[number, number]> = [], windows: Array<[number, number]> = []) => {
    const h = partition ? 1.15 : WALL_H
    const holder = new THREE.Group()
    // split the run around door gaps
    const segs: Array<[number, number]> = []
    let s0 = -len / 2
    for (const [g0, gw] of gaps.sort((a, b) => a[0] - b[0])) {
      if (g0 - gw / 2 > s0) segs.push([s0, g0 - gw / 2])
      s0 = g0 + gw / 2
    }
    if (s0 < len / 2) segs.push([s0, len / 2])
    const parts: THREE.BufferGeometry[] = []
    for (const [a, b] of segs) {
      const l = b - a
      const m = (a + b) / 2
      parts.push(along === 'x' ? box(l, h, T, m, h / 2, 0) : box(T, h, l, 0, h / 2, m))
      // skirting board
      parts.push(along === 'x' ? box(l, 0.1, T + 0.04, m, 0.05, 0) : box(T + 0.04, 0.1, l, 0, 0.05, m))
    }
    for (const p of parts) {
      const mesh = new THREE.Mesh(p, paintMat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      holder.add(mesh)
      disposables.push(p)
    }
    // windows: bright glazed panel + frame + curtains (outer walls only)
    for (const [wPos, wW] of windows) {
      const glass = along === 'x' ? box(wW, 1.15, 0.04, wPos, 1.65, -0.1 * nz) : box(0.04, 1.15, wW, -0.1 * nx, 1.65, wPos)
      const gm = new THREE.Mesh(glass, std({ color: '#cfe6f0', emissive: '#bfe0f0', emissiveIntensity: 0.6, roughness: 0.1 }))
      gm.userData.deco = true
      holder.add(gm)
      disposables.push(glass)
      const off = 0.14
      const cur = merge([
        [accent, along === 'x' ? box(0.45, 1.75, 0.05, wPos - wW / 2 - 0.1, 1.55, off * nz * -1) : box(0.05, 1.75, 0.45, off * nx * -1, 1.55, wPos - wW / 2 - 0.1)],
        [accent, along === 'x' ? box(0.45, 1.75, 0.05, wPos + wW / 2 + 0.1, 1.55, off * nz * -1) : box(0.05, 1.75, 0.45, off * nx * -1, 1.55, wPos + wW / 2 + 0.1)],
        ['#2a2a2e', along === 'x' ? box(wW + 1.2, 0.04, 0.04, wPos, 2.45, off * nz * -1) : box(0.04, 0.04, wW + 1.2, off * nx * -1, 2.45, wPos)]
      ])
      const cm = new THREE.Mesh(cur, furnMat)
      cm.userData.deco = true
      holder.add(cm)
      disposables.push(cur)
    }
    holder.position.set(cx, 0, cz)
    group.add(holder)
    walls.push({ mesh: holder, nx, nz, partition })
    // colliders (one per segment)
    for (const [a, b] of segs) {
      const l = b - a
      const m = (a + b) / 2
      colliders.push(along === 'x' ? { x: cx + m, z: cz, w: l, d: T + 0.1 } : { x: cx, z: cz + m, w: T + 0.1, d: l })
    }
  }
  // outer shell (front door gap 1.6 at x = 0)
  wall(W, 'x', 0, -D / 2, 0, -1, false, [], [[-W / 2 + bedW / 2, 1.5], [(xBath1 + W / 2) / 2, 1.4]])
  wall(D, 'z', -W / 2, 0, -1, 0, false, [], [[(backZ + D / 2) / 2, 1.8]])
  wall(D, 'z', W / 2, 0, 1, 0, false, [], [[(backZ + D / 2) / 2 + 0.6, 1.6]])
  wall(W, 'x', 0, D / 2, 0, 1, false, [[0, 1.6]], [[-W / 4 - 0.6, 1.6], [W / 4 + 0.6, 1.6]])
  // partitions (half height for the cut-away look) with door gaps
  wall(bedW, 'x', -W / 2 + bedW / 2, backZ, 0, 1, true, [[1.0, 1.3]])
  wall(bathW, 'x', xBed1 + bathW / 2, backZ, 0, 1, true, [[0, 1.2]])
  wall(BACK, 'z', xBed1, -D / 2 + BACK / 2, 1, 0, true)
  wall(BACK, 'z', xBath1, -D / 2 + BACK / 2, 1, 0, true)
  // front door: open leaf + threshold
  add(merge([['#5a3a22', rotY(box(0.9, 2.15, 0.05, 0.45, 1.08, 0), -1.3, -0.8, D / 2)], ['#3a2a1a', box(1.7, 0.04, 0.3, 0, 0.02, D / 2)], ['#c8b88a', box(0.08, 0.08, 0.08, 0, 0, 0)]]), furnMat)

  // ---------------------------------------------------------- living room
  const P: Part[] = [] // matte furniture
  const G: Part[] = [] // glossy bits (tv, glass, ceramics, metal)
  const lz0 = backZ + 0.2
  const lzMid = (lz0 + D / 2) / 2
  const tvX = -W / 2 + 0.32
  const sx = tvX + 3.3
  if (!custom) {
  // TV wall on the left: console + flat TV + wall shelf
  P.push(['#5a3a24', rbox(0.45, 0.5, 2.2, tvX, 0.25, lzMid, 0.03)])
  P.push(['#3a2416', box(0.42, 0.03, 2.1, tvX + 0.02, 0.51, lzMid)])
  G.push(['#101114', rbox(0.06, 0.82, 1.42, tvX - 0.05, 1.3, lzMid, 0.02)])
  G.push(['#1c1d22', box(0.18, 0.04, 0.4, tvX, 0.52, lzMid)])
  G.push(['#2a2b30', box(0.2, 0.1, 0.08, tvX + 0.1, 0.57, lzMid + 0.7)]) // decoder
  P.push(['#6b4a2f', box(0.24, 0.03, 1.2, tvX - 0.05, 2.0, lzMid)])
  for (let i = 0; i < 4; i++) P.push([pick(['#b8433a', '#3f6fae', '#e8b84b', '#2f7d5b']), box(0.16, 0.22, 0.05, tvX - 0.02, 2.13, lzMid - 0.4 + i * 0.09)])
  G.push(['#f2ede0', cyl(0.07, 0.05, 0.2, tvX - 0.02, 2.12, lzMid + 0.35, 10)])
  colliders.push({ x: tvX, z: lzMid, w: 0.6, d: 2.3 })
  // three-seat sofa facing the TV
  const sofa: Part[] = [
    [sofaCol, rbox(0.95, 0.42, 2.4, sx, 0.21 + 0.08, lzMid, 0.08)],
    [sofaCol, rbox(0.25, 0.75, 2.4, sx + 0.42, 0.52, lzMid, 0.1)],
    [sofaCol, rbox(0.9, 0.62, 0.22, sx, 0.4, lzMid - 1.22, 0.08)],
    [sofaCol, rbox(0.9, 0.62, 0.22, sx, 0.4, lzMid + 1.22, 0.08)]
  ]
  for (let i = 0; i < 3; i++) {
    const z = lzMid - 0.74 + i * 0.74
    sofa.push([sofaCol, rbox(0.72, 0.16, 0.72, sx - 0.06, 0.58, z, 0.06)])
    sofa.push([sofaCol, rbox(0.18, 0.5, 0.7, sx + 0.27, 0.86, z, 0.07)])
  }
  sofa.push([accent, rbox(0.12, 0.36, 0.36, sx + 0.16, 0.86, lzMid - 0.85, 0.06)])
  sofa.push(['#f2c12e', rbox(0.12, 0.34, 0.34, sx + 0.16, 0.86, lzMid + 0.8, 0.06)])
  for (const z of [lzMid - 1.1, lzMid + 1.1]) for (const dx of [-0.38, 0.38]) sofa.push(['#2a1e14', cyl(0.025, 0.025, 0.1, sx + dx, 0.05, z, 6)])
  P.push(...sofa)
  colliders.push({ x: sx + 0.05, z: lzMid, w: 1.1, d: 2.65 })
  // armchair beside the sofa
  const ax = sx - 1.1
  const az = lzMid + 2.0 > D / 2 - 1.6 ? lzMid - 2.0 : lzMid + 2.0
  if (Math.abs(az - lzMid) < 3 && az > lz0 + 0.6 && az < D / 2 - 1.2) {
    const chairParts: Part[] = [
      [sofaCol, rbox(0.85, 0.4, 0.85, 0, 0.3, 0, 0.08)],
      [sofaCol, rbox(0.85, 0.7, 0.2, 0, 0.55, 0.36, 0.08)],
      [sofaCol, rbox(0.18, 0.55, 0.8, -0.38, 0.45, 0, 0.07)],
      [sofaCol, rbox(0.18, 0.55, 0.8, 0.38, 0.45, 0, 0.07)],
      [sofaCol, rbox(0.6, 0.14, 0.6, 0, 0.55, -0.04, 0.05)]
    ]
    const facing = az > lzMid ? Math.PI * 0.75 : Math.PI * 0.25
    for (const [c, g] of chairParts) P.push([c, rotY(g, facing, ax, az)])
    colliders.push({ x: ax, z: az, w: 0.95, d: 0.95 })
  }
  // coffee table (glass top), rug, floor lamp, plants
  const cx2 = (tvX + sx) / 2 + 0.2
  G.push(['#bcd6dc', rbox(0.9, 0.03, 1.3, cx2, 0.44, lzMid, 0.015)])
  for (const [dx, dz] of [[-0.38, -0.58], [0.38, -0.58], [-0.38, 0.58], [0.38, 0.58]]) P.push(['#3a2a1a', box(0.05, 0.43, 0.05, cx2 + dx, 0.215, lzMid + dz)])
  P.push(['#3a2a1a', box(0.8, 0.02, 1.2, cx2, 0.15, lzMid)])
  G.push(['#d8b13c', cyl(0.09, 0.06, 0.22, cx2, 0.57, lzMid - 0.3, 12)])
  P.push(['#c84a3a', sph(0.05, cx2 + 0.02, 0.72, lzMid - 0.3)])
  P.push(['#2f7d5b', box(0.22, 0.04, 0.3, cx2 - 0.1, 0.47, lzMid + 0.3)])
  P.push(['#f2ede0', box(0.2, 0.03, 0.28, cx2 - 0.1, 0.5, lzMid + 0.3)])
  G.push(['#f4f4f4', cyl(0.04, 0.035, 0.09, cx2 + 0.2, 0.5, lzMid + 0.1, 10)])
  colliders.push({ x: cx2, z: lzMid, w: 0.95, d: 1.35 })
  const rugGeo = new THREE.PlaneGeometry(2.6, 3.2).rotateX(-Math.PI / 2).translate(cx2 + 0.3, 0.012, lzMid)
  add(rugGeo, std({ map: rugTex, roughness: 0.95 }), false)
  // floor lamp in the corner
  const lx = -W / 2 + 0.5
  const lz = D / 2 - 0.6
  G.push(['#2a2b30', cyl(0.16, 0.18, 0.04, lx, 0.02, lz, 14)])
  G.push(['#2a2b30', cyl(0.015, 0.015, 1.5, lx, 0.77, lz, 6)])
  P.push(['#f2e2c0', cyl(0.14, 0.24, 0.32, lx, 1.62, lz, 16)])
  colliders.push({ x: lx, z: lz, w: 0.4, d: 0.4 })
  // snake plants in clay pots
  const plant = (x: number, z: number, s = 1) => {
    P.push(['#a85a2a', cyl(0.16 * s, 0.12 * s, 0.32 * s, x, 0.16 * s, z, 14)])
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      const leaf = box(0.06 * s, 0.75 * s, 0.015, 0, 0.37 * s, 0).rotateZ(0.12 * Math.sin(a * 3)).rotateY(a).translate(x + Math.cos(a) * 0.05, 0.3 * s, z + Math.sin(a) * 0.05)
      P.push([i % 2 ? '#2f6a3a' : '#4f8a3f', leaf])
    }
    colliders.push({ x, z, w: 0.4 * s, d: 0.4 * s })
  }
  plant(W / 2 - 0.45, D / 2 - 0.45)
  plant(sx + 0.6, lzMid + 1.6, 0.9)
  } // end movable living-room furniture
  // wall art above the sofa (on the right wall stays visible) + clock
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), std({ map: artTex(seed) }))
  art.position.set(W / 2 - T / 2 - 0.02, 1.75, lzMid + 0.6)
  art.rotation.y = -Math.PI / 2
  group.add(art)
  disposables.push(art.geometry)
  P.push(['#3a2a1a', box(0.04, 0.83, 1.18, W / 2 - T / 2 - 0.01, 1.75, lzMid + 0.6)])
  G.push(['#f4f4f0', cyl(0.2, 0.2, 0.04, 0, 0, 0, 20).rotateX(Math.PI / 2).translate(0, 2.25, -D / 2 + T / 2 + 0.03)])
  P.push(['#1d1d20', box(0.02, 0.15, 0.01, 0.02, 2.28, -D / 2 + T / 2 + 0.06)])
  P.push(['#1d1d20', box(0.11, 0.02, 0.01, 0.05, 2.25, -D / 2 + T / 2 + 0.06)])
  if (!custom) {
  // standing fan (Nigerian heat)
  const fx = sx + 0.9
  const fz = lz0 + 0.5
  G.push(['#e8e8e4', cyl(0.18, 0.2, 0.04, fx, 0.02, fz, 16)])
  G.push(['#e8e8e4', cyl(0.02, 0.02, 1.0, fx, 0.52, fz, 6)])
  G.push(['#cfd8dc', cyl(0.26, 0.26, 0.1, 0, 0, 0, 20).rotateX(Math.PI / 2).translate(fx, 1.12, fz + 0.05)])
  P.push(['#3f6fae', cyl(0.07, 0.07, 0.12, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(fx, 1.12, fz + 0.05)])
  colliders.push({ x: fx, z: fz, w: 0.45, d: 0.45 })
  }

  // ---------------------------------------------------------- dining
  const dx0 = W / 2 - 1.7
  const dz0 = lz0 + 1.3
  if (!custom) {
  P.push(['#7a5232', rbox(1.5, 0.06, 0.95, dx0, 0.76, dz0, 0.02)])
  for (const [ex, ez] of [[-0.66, -0.4], [0.66, -0.4], [-0.66, 0.4], [0.66, 0.4]]) P.push(['#5a3a24', box(0.06, 0.74, 0.06, dx0 + ex, 0.37, dz0 + ez)])
  G.push(['#f4f4f0', cyl(0.2, 0.12, 0.1, dx0, 0.84, dz0, 16)])
  P.push(['#e8a020', sph(0.06, dx0 - 0.05, 0.9, dz0)])
  P.push(['#c83a2a', sph(0.055, dx0 + 0.07, 0.9, dz0 + 0.04)])
  P.push(['#7ab040', sph(0.055, dx0 + 0.02, 0.92, dz0 - 0.07)])
  const chair = (x: number, z: number, a: number) => {
    const parts: Part[] = [
      ['#8a5a36', box(0.44, 0.05, 0.44, 0, 0.46, 0)],
      ['#8a5a36', box(0.44, 0.5, 0.05, 0, 0.72, -0.2)],
      [accent, rbox(0.4, 0.05, 0.4, 0, 0.5, 0.01, 0.02)]
    ]
    for (const [ex, ez] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) parts.push(['#5a3a24', box(0.04, 0.46, 0.04, ex, 0.23, ez)])
    for (const [c, g] of parts) P.push([c, rotY(g, a, x, z)])
  }
  chair(dx0 - 0.35, dz0 - 0.75, 0)
  chair(dx0 + 0.35, dz0 - 0.75, 0)
  chair(dx0 - 0.35, dz0 + 0.75, Math.PI)
  chair(dx0 + 0.35, dz0 + 0.75, Math.PI)
  colliders.push({ x: dx0, z: dz0, w: 1.6, d: 2.0 })
  }

  // ---------------------------------------------------------- kitchen
  const kx0 = xBath1
  const kx1 = W / 2
  const kz = -D / 2 + 0.33
  const kLen = kx1 - kx0 - 0.1
  P.push(['#f2f0ea', box(kLen, 0.86, 0.6, (kx0 + kx1) / 2, 0.43, kz)])
  G.push(['#2a2b30', box(kLen + 0.02, 0.04, 0.64, (kx0 + kx1) / 2, 0.88, kz + 0.01)])
  for (let i = 0; i < Math.floor(kLen / 0.6); i++) {
    const x = kx0 + 0.35 + i * 0.6
    P.push(['#d8d4ca', box(0.56, 0.7, 0.01, x, 0.45, kz + 0.305)])
    G.push(['#9aa0a6', box(0.12, 0.02, 0.02, x, 0.72, kz + 0.32)])
  }
  // upper cabinets
  P.push(['#f2f0ea', box(kLen, 0.6, 0.34, (kx0 + kx1) / 2, 2.05, -D / 2 + 0.26)])
  // sink + tap, gas cooker with a cylinder, pots, microwave, fridge
  const sinkX = kx0 + 0.75
  G.push(['#c8ccd2', box(0.6, 0.04, 0.42, sinkX, 0.9, kz)])
  G.push(['#8a9098', box(0.5, 0.12, 0.34, sinkX, 0.84, kz)])
  G.push(['#c8ccd2', cyl(0.015, 0.015, 0.3, sinkX, 1.04, kz - 0.18, 8)])
  G.push(['#c8ccd2', box(0.02, 0.02, 0.16, sinkX, 1.19, kz - 0.1)])
  const ckX = sinkX + 1.0
  G.push(['#2a2b30', box(0.6, 0.06, 0.5, ckX, 0.93, kz)])
  for (const [ex, ez] of [[-0.14, -0.11], [0.14, -0.11], [-0.14, 0.11], [0.14, 0.11]]) G.push(['#555a60', cyl(0.07, 0.07, 0.02, ckX + ex, 0.97, kz + ez, 14)])
  G.push(['#3a3f46', cyl(0.12, 0.11, 0.16, ckX - 0.14, 1.06, kz + 0.11, 16)])
  G.push(['#b8433a', cyl(0.13, 0.13, 0.42, kx0 + 0.1 + kLen - 0.25, 0.21, kz + 0.5, 16)]) // gas cylinder
  G.push(['#2a2b30', box(0.45, 0.28, 0.34, ckX + 0.75, 1.04, kz)])
  G.push(['#101114', box(0.3, 0.2, 0.01, ckX + 0.7, 1.04, kz + 0.17)])
  const frX = kx1 - 0.42
  const frZ = -D / 2 + BACK - 0.5
  G.push(['#e8eaee', rbox(0.7, 1.8, 0.68, frX, 0.9, frZ, 0.05)])
  G.push(['#9aa0a6', box(0.02, 0.6, 0.03, frX - 0.36, 1.2, frZ + 0.2)])
  colliders.push({ x: (kx0 + kx1) / 2, z: kz, w: kLen, d: 0.7 })
  colliders.push({ x: frX, z: frZ, w: 0.75, d: 0.75 })

  // ---------------------------------------------------------- bedroom
  const bx = -W / 2 + 1.1
  const bz = -D / 2 + 1.3
  if (!custom) {
  P.push(['#6a4428', rbox(1.6, 1.1, 0.1, bx, 0.55, -D / 2 + T / 2 + 0.06, 0.04)]) // headboard
  P.push(['#6a4428', box(1.6, 0.28, 2.1, bx, 0.2, bz + 0.05)])
  P.push(['#f4f2ec', rbox(1.5, 0.22, 2.0, bx, 0.45, bz + 0.05, 0.06)])
  P.push([duvet, rbox(1.56, 0.1, 1.35, bx, 0.58, bz + 0.4, 0.04)])
  P.push(['#f4f2ec', rbox(0.6, 0.14, 0.38, bx - 0.36, 0.62, -D / 2 + 0.45, 0.06)])
  P.push(['#f4f2ec', rbox(0.6, 0.14, 0.38, bx + 0.36, 0.62, -D / 2 + 0.45, 0.06)])
  for (const s of [-1, 1]) {
    const nx = bx + s * 1.1
    if (nx < -W / 2 + 0.25 || nx > xBed1 - 0.25) continue
    P.push(['#5a3a24', box(0.42, 0.5, 0.38, nx, 0.25, -D / 2 + 0.35)])
    G.push(['#d8b13c', cyl(0.04, 0.06, 0.25, nx, 0.62, -D / 2 + 0.35, 10)])
    P.push(['#f2e2c0', cyl(0.1, 0.15, 0.18, nx, 0.82, -D / 2 + 0.35, 14)])
  }
  colliders.push({ x: bx, z: bz, w: 1.7, d: 2.3 })
  // wardrobe with two doors
  const wx = xBed1 - 0.35
  const wz = -D / 2 + 1.2
  P.push(['#7a5232', box(0.6, 2.0, 1.4, wx, 1.0, wz)])
  P.push(['#3a2416', box(0.01, 1.9, 0.01, wx - 0.305, 1.0, wz)])
  G.push(['#c8ccd2', box(0.02, 0.2, 0.02, wx - 0.31, 1.05, wz - 0.08)])
  G.push(['#c8ccd2', box(0.02, 0.2, 0.02, wx - 0.31, 1.05, wz + 0.08)])
  colliders.push({ x: wx, z: wz, w: 0.65, d: 1.45 })
  const bedRug = new THREE.PlaneGeometry(1.2, 0.8).rotateX(-Math.PI / 2).translate(bx + 0.9, 0.012, bz + 1.35)
  add(bedRug, std({ map: rugTex, roughness: 0.95 }), false)
  }

  // ---------------------------------------------------------- bathroom
  const tx = xBed1 + bathW / 2
  G.push(['#f8f8f6', rbox(0.4, 0.42, 0.5, tx - 0.55, 0.21, -D / 2 + 0.55, 0.12)]) // wc bowl
  G.push(['#f8f8f6', rbox(0.4, 0.4, 0.18, tx - 0.55, 0.6, -D / 2 + 0.2, 0.04)]) // cistern
  G.push(['#f8f8f6', rbox(0.42, 0.04, 0.48, tx - 0.55, 0.44, -D / 2 + 0.56, 0.02)])
  G.push(['#f8f8f6', cyl(0.07, 0.1, 0.75, tx + 0.55, 0.38, -D / 2 + 0.4, 12)]) // basin pedestal
  G.push(['#f8f8f6', rbox(0.5, 0.12, 0.38, tx + 0.55, 0.8, -D / 2 + 0.35, 0.05)])
  G.push(['#b8d8e4', box(0.45, 0.6, 0.02, tx + 0.55, 1.45, -D / 2 + T / 2 + 0.02)]) // mirror
  G.push(['#dfeef2', box(0.9, 0.06, 0.9, tx, 0.03, -D / 2 + BACK - 0.7)]) // shower tray
  G.push(['#bcd6dc', box(0.02, 1.9, 0.9, tx - 0.45, 1.0, -D / 2 + BACK - 0.7)])
  G.push(['#c8ccd2', cyl(0.07, 0.07, 0.02, tx + 0.3, 2.1, -D / 2 + BACK - 0.7, 12)])
  P.push(['#3f6fae', box(0.04, 0.5, 0.35, tx + bathW / 2 - 0.12, 1.2, -D / 2 + BACK - 1.9)]) // towel
  colliders.push({ x: tx - 0.55, z: -D / 2 + 0.45, w: 0.5, d: 0.75 })
  colliders.push({ x: tx + 0.55, z: -D / 2 + 0.4, w: 0.55, d: 0.45 })

  const pm = add(merge(P), furnMat)
  const gm = add(merge(G), glossMat)
  void pm
  void gm
  // TV picture (emissive so it glows)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 0.74), std({ map: screenTex(), emissive: '#ffffff', emissiveMap: screenTex(), emissiveIntensity: 0.8 }))
  screen.position.set(tvX - 0.015, 1.3, lzMid)
  screen.rotation.y = Math.PI / 2
  group.add(screen)
  disposables.push(screen.geometry)

  // warm room lights + a soft fill so the home never looks like a cave
  const lamp = new THREE.PointLight('#ffe2b8', 2.2, 18, 1.5)
  lamp.position.set(0, 2.6, lzMid)
  group.add(lamp)
  const bedLamp = new THREE.PointLight('#ffd9a0', 1.1, 7, 1.6)
  bedLamp.position.set(bx, 2.2, bz)
  group.add(bedLamp)
  const hemi = new THREE.HemisphereLight('#fff6e6', '#8a7a64', 0.9)
  hemi.position.set(0, 3, 0)
  group.add(hemi)

  // dark "studio" backdrop so the cut-away reads as a doll's house, not
  // a room floating under the city
  const backdrop = new THREE.Mesh(new THREE.BoxGeometry(W + 60, 40, D + 60), new THREE.MeshBasicMaterial({ color: '#1d1a17', side: THREE.BackSide, fog: false }))
  backdrop.position.y = 10
  group.add(backdrop)
  disposables.push(backdrop.geometry, backdrop.material as THREE.Material)
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(W + 8, D + 8).rotateX(-Math.PI / 2).translate(0, -0.02, 0), std({ color: '#4a6a3a', roughness: 1 }))
  group.add(lawn)
  disposables.push(lawn.geometry)

  // usable spots: stand in front of each appliance
  const hotspots: Hotspot[] = [
    { id: 'fridge', x: frX - 0.1, z: frZ + 0.85, fx: frX, fz: frZ },
    { id: 'cooker', x: ckX, z: kz + 0.8, fx: ckX, fz: kz },
    ...(custom ? [] : [
    { id: 'bed' as const, x: bx, z: bz + 1.55, fx: bx, fz: bz, seat: { x: bx, z: bz + 0.15, h: 0.52, yaw: 0 } },
    { id: 'tv' as const, x: sx - 0.85, z: lzMid - 0.5, fx: tvX, fz: lzMid, seat: { x: sx - 0.04, z: lzMid - 0.55, h: 0.44, yaw: -Math.PI / 2 } },
    { id: 'sofa' as const, x: sx - 0.85, z: lzMid + 0.6, fx: sx, fz: lzMid, seat: { x: sx - 0.02, z: lzMid, h: 0.42, yaw: 0 } },
    { id: 'dining' as const, x: dx0 - 0.35, z: dz0 - 1.25, fx: dx0, fz: dz0, seat: { x: dx0 - 0.35, z: dz0 - 0.78, h: 0.48, yaw: 0 } }]),
    { id: 'toilet', x: tx - 0.55, z: -D / 2 + 1.2, fx: tx - 0.55, fz: -D / 2 + 0.5 },
    { id: 'shower', x: tx + 0.1, z: -D / 2 + BACK - 0.75, fx: tx + 0.3, fz: -D / 2 + BACK - 0.7 }
  ]

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

/** Cut away the walls between the camera and the room (local camera pos). */
export function cutaway(room: BuiltRoom, camLocalX: number, camLocalZ: number) {
  for (const w of room.walls) {
    const facing = camLocalX * w.nx + camLocalZ * w.nz > 0.5
    const target = w.partition ? 1 : facing ? 0.14 : 1
    const s = w.mesh.scale.y
    w.mesh.scale.y = s + (target - s) * 0.25
    // windows + curtains vanish with a cut-away wall
    for (const c of w.mesh.children) if (c.userData.deco) c.visible = w.mesh.scale.y > 0.6
  }
}
