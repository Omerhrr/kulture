// Public buildings: schools, hospitals, filling stations and mechanic
// workshops. Sites are placed by kaduna.ts (densify); this module turns
// them into one merged vertex-coloured mesh + name boards.
import * as THREE from 'three'
import { BAKE, type CivicSite } from './kaduna'
import { vehicleSpec } from './vehicles'

/** [colour or '*tint' / '__keep', geometry, optional local transform]. Shared
 * templates (vehicle bodies) are never cloned: their transform is applied
 * while writing straight into the merged buffers. */
type Part = [string, THREE.BufferGeometry, THREE.Matrix4?]

class Site {
  parts: Part[] = []
  box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string) {
    this.parts.push([hex, new THREE.BoxGeometry(w, h, d).translate(x, y, z)])
  }
  cyl(r: number, h: number, x: number, y: number, z: number, hex: string, seg = 10, rb = r) {
    this.parts.push([hex, new THREE.CylinderGeometry(r, rb, h, seg).translate(x, y, z)])
  }
  hip(w: number, d: number, h: number, x: number, y: number, z: number, hex: string) {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, h, 4, 1)
    g.rotateY(Math.PI / 4)
    g.scale(w, 1, d)
    g.translate(x, y + h / 2, z)
    this.parts.push([hex, g])
  }
  geo(g: THREE.BufferGeometry, hex: string | null, x: number, y: number, z: number, ry = 0) {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z)
    this.parts.push([hex ? '*' + hex : '__keep', g, m])
  }
  /** perimeter wall with a gate gap on the street side (+z) */
  wall(w: number, d: number, hex: string, gate = 8, h = 2.2) {
    const t = 0.4
    this.box(w, h, t, 0, h / 2, -d / 2, hex)
    this.box(t, h, d, -w / 2, h / 2, 0, hex)
    this.box(t, h, d, w / 2, h / 2, 0, hex)
    const seg = (w - gate) / 2
    this.box(seg, h, t, -w / 2 + seg / 2, h / 2, d / 2, hex)
    this.box(seg, h, t, w / 2 - seg / 2, h / 2, d / 2, hex)
    this.box(0.8, h + 0.8, 0.8, -gate / 2, (h + 0.8) / 2, d / 2, '#e8e2d2')
    this.box(0.8, h + 0.8, 0.8, gate / 2, (h + 0.8) / 2, d / 2, '#e8e2d2')
  }
  windows(face: 'front' | 'back', cx: number, cz: number, halfW: number, halfD: number, y: number, n: number, w: number, h: number, hex = '#2c3e4c') {
    for (let i = 0; i < n; i++) {
      const x = cx - halfW + ((i + 0.5) / n) * halfW * 2
      const z = face === 'front' ? cz + halfD + 0.04 : cz - halfD - 0.04
      this.box(w, h, 0.1, x, y, z, hex)
    }
  }
}

function school(s: Site, c: CivicSite) {
  const { w, d } = c
  s.box(w, 0.06, d, 0, 0.03, 0, '#c9b78e') // sandy compound
  s.wall(w, d, '#e8dcc4')
  s.box(w + 0.2, 0.3, 0.5, 0, 1.2, -d / 2, '#3f6fae')
  // classroom block A: long single storey with a columned verandah
  const ax = -w * 0.18
  const az = -d * 0.28
  const aw = w * 0.55
  s.box(aw, 4.2, 9, ax, 2.1, az, '#efe6d0')
  s.hip(aw + 1.6, 12.4, 2.2, ax, 4.2, az + 1.2, '#8a8f96')
  s.box(aw, 0.25, 3.2, ax, 0.12, az + 6.1, '#cfc8ba')
  for (let i = 0; i <= 10; i++) s.cyl(0.18, 4.2, ax - aw / 2 + (i / 10) * aw, 2.1, az + 7.4, '#f4f1ea', 8)
  s.windows('front', ax, az, aw / 2 - 1, 4.5, 2.1, 9, 1.8, 1.4, '#4a78a8')
  for (let i = 0; i < 4; i++) s.box(1.1, 2.3, 0.1, ax - aw / 2 + 3 + i * (aw - 6) / 3, 1.15, az + 4.55, '#6b4a2f')
  // block B (perpendicular wing)
  const bx = w * 0.3
  const bz = d * 0.05
  const bd = d * 0.45
  s.box(9, 4.2, bd, bx, 2.1, bz, '#efe6d0')
  s.hip(12, bd + 1.6, 2.2, bx - 1.2, 4.2, bz, '#8a8f96')
  for (let i = 0; i <= 6; i++) s.cyl(0.18, 4.2, bx - 6, 2.1, bz - bd / 2 + (i / 6) * bd, '#f4f1ea', 8)
  // football pitch + goals
  const px = -w * 0.18
  const pz = d * 0.2
  s.box(w * 0.5, 0.05, d * 0.32, px, 0.08, pz, '#6fa04a')
  for (const sd of [-1, 1]) {
    const gx = px + sd * w * 0.24
    s.box(0.12, 2.2, 0.12, gx, 1.1, pz - 2.4, '#ffffff')
    s.box(0.12, 2.2, 0.12, gx, 1.1, pz + 2.4, '#ffffff')
    s.box(0.12, 0.12, 4.9, gx, 2.2, pz, '#ffffff')
  }
  // flag pole: green-white-green
  s.cyl(0.08, 9, w * 0.2, 4.5, d / 2 - 4, '#d8dce0', 6)
  s.box(0.6, 1.2, 0.04, w * 0.2 + 0.35, 8.3, d / 2 - 4, '#008751')
  s.box(0.6, 1.2, 0.04, w * 0.2 + 0.95, 8.3, d / 2 - 4, '#ffffff')
  s.box(0.6, 1.2, 0.04, w * 0.2 + 1.55, 8.3, d / 2 - 4, '#008751')
  // gate arch board
  s.box(9, 1.2, 0.3, 0, 3.8, d / 2, '#1e5c38')
}

function hospital(s: Site, c: CivicSite) {
  const { w, d } = c
  s.box(w, 0.06, d, 0, 0.03, 0, '#b8b2a6') // paved compound
  s.wall(w, d, '#eef0ea', 10)
  // main block: three floors, blue window bands, red cross
  const mw = w * 0.62
  const mz = -d * 0.12
  s.box(mw, 11, 17, 0, 5.5, mz, '#f4f6f2')
  s.box(mw + 0.4, 0.6, 17.4, 0, 11.3, mz, '#d8dce0')
  for (let f = 0; f < 3; f++) {
    s.box(mw - 2, 1.3, 0.12, 0, 1.9 + f * 3.5, mz + 8.55, '#5a8ab8')
    s.box(mw - 2, 1.3, 0.12, 0, 1.9 + f * 3.5, mz - 8.55, '#5a8ab8')
  }
  s.box(3.2, 0.9, 0.2, 0, 9.6, mz + 8.7, '#d8262e')
  s.box(0.9, 3.2, 0.2, 0, 9.6, mz + 8.7, '#d8262e')
  // entrance canopy + emergency wing
  s.box(10, 0.35, 6, 0, 3.6, mz + 11.5, '#ffffff')
  for (const sx of [-4.6, 4.6]) s.cyl(0.22, 3.6, sx, 1.8, mz + 14, '#d8dce0', 8)
  s.box(9, 2.6, 0.12, 0, 1.4, mz + 8.6, '#2c3e4c')
  const ex = -w * 0.32
  const ez = d * 0.18
  s.box(12, 7, 14, ex, 3.5, ez, '#f4f6f2')
  s.box(12.4, 0.5, 14.4, ex, 7.2, ez, '#d8dce0')
  s.box(6, 1.1, 0.2, ex, 5.6, ez + 7.1, '#d8262e')
  // ambulance: white van with a red stripe
  const van = vehicleSpec('bus').geo
  s.geo(van, '#f4f4f0', w * 0.18, 0, d * 0.28, Math.PI / 2)
  s.box(5.2, 0.3, 2.3, w * 0.18, 1.2, d * 0.28, '#d8262e')
  // car park lines
  for (let i = 0; i < 6; i++) s.box(0.15, 0.02, 5, w * 0.05 + i * 3, 0.08, d * 0.36, '#ffffff')
  // palms in the compound
  for (const [tx, tz] of [[-w * 0.42, -d * 0.42], [w * 0.42, -d * 0.42], [w * 0.42, d * 0.1]]) {
    s.cyl(0.22, 7, tx, 3.5, tz, '#7a5c3a', 6, 0.3)
    s.parts.push(['#4f7d3f', new THREE.SphereGeometry(2.2, 8, 6).scale(1, 0.45, 1).translate(tx, 7.2, tz)])
  }
}

function fuel(s: Site, c: CivicSite) {
  const { w, d } = c
  s.box(w, 0.08, d, 0, 0.05, 0, '#c8c4bc') // forecourt
  // canopy on four columns, branded fascia
  const cw = w * 0.72
  s.box(cw, 0.5, 13, 0, 5.8, 2, '#f4f4f0')
  s.box(cw + 0.2, 0.9, 13.2, 0, 6.4, 2, '#1e8a4a')
  s.box(cw + 0.25, 0.25, 13.25, 0, 5.9, 2, '#f2c12e')
  for (const sx of [-cw / 2 + 2, cw / 2 - 2]) for (const sz of [-2.5, 6.5]) s.box(0.5, 5.6, 0.5, sx, 2.8, sz, '#d8dce0')
  // pump islands
  for (const sx of [-cw / 4, cw / 4]) {
    s.box(1.4, 0.25, 6, sx, 0.15, 2, '#e8e4d8')
    for (const sz of [0, 4]) {
      s.box(0.9, 1.8, 0.6, sx, 1.15, sz, '#1e8a4a')
      s.box(0.7, 0.5, 0.05, sx, 1.6, sz + 0.33, '#101418')
      s.box(0.12, 0.6, 0.12, sx + 0.5, 0.9, sz, '#2b2f36')
    }
  }
  // shop kiosk at the back
  s.box(12, 3.6, 7, 0, 1.8, -d / 2 + 4.5, '#f4f4f0')
  s.box(10, 2.2, 0.1, 0, 1.6, -d / 2 + 8.05, '#2c3e4c')
  s.box(12.4, 0.4, 7.4, 0, 3.8, -d / 2 + 4.5, '#1e8a4a')
  // price board on a pylon by the road
  s.box(0.4, 7, 0.4, w / 2 - 2, 3.5, d / 2 - 1.5, '#d8dce0')
  s.box(2.6, 3.4, 0.35, w / 2 - 2, 6.4, d / 2 - 1.5, '#1e8a4a')
  s.box(2.2, 1.6, 0.4, w / 2 - 2, 5.9, d / 2 - 1.5, '#101418')
  // a customer filling up
  s.geo(vehicleSpec('car', 'lo').geo, '#b8433a', -cw / 4 + 2.2, 0, 2, 0)
}

function mechanic(s: Site, c: CivicSite) {
  const { w, d } = c
  s.box(w, 0.05, d, 0, 0.03, 0, '#8a7458') // oily dirt lot
  // open shed: back wall + rusty zinc roof on posts
  s.box(w - 2, 3.2, 0.3, 0, 1.6, -d / 2 + 2, '#b8b0a0')
  const roof = new THREE.BoxGeometry(w - 1, 0.12, 8)
  roof.rotateX(0.12)
  roof.translate(0, 3.6, -d / 2 + 5.5)
  s.parts.push(['#8a6a4a', roof])
  for (const sx of [-w / 2 + 1.2, 0, w / 2 - 1.2]) s.cyl(0.1, 3.4, sx, 1.7, -d / 2 + 9, '#6b6f75', 6)
  // cars under repair (one on blocks), tyres, drums, workbench
  s.geo(vehicleSpec('car', 'lo').geo, '#8a8f96', -w * 0.22, 0.35, -d / 2 + 5.5, Math.PI / 2)
  s.box(0.5, 0.35, 0.5, -w * 0.22 - 1.3, 0.18, -d / 2 + 5.5, '#4a4a50')
  s.box(0.5, 0.35, 0.5, -w * 0.22 + 1.3, 0.18, -d / 2 + 5.5, '#4a4a50')
  s.geo(vehicleSpec('car', 'lo').geo, '#3f6fae', w * 0.2, 0, 0.5, 0.3)
  for (let i = 0; i < 5; i++) {
    const t = new THREE.TorusGeometry(0.36, 0.14, 6, 12)
    t.rotateX(Math.PI / 2)
    t.translate(w / 2 - 2, 0.15 + i * 0.27, -d / 2 + 3)
    s.parts.push(['#1d1d20', t])
  }
  s.cyl(0.32, 0.9, -w / 2 + 2, 0.45, d / 2 - 2.5, '#2f5ea8', 10)
  s.cyl(0.32, 0.9, -w / 2 + 2.8, 0.45, d / 2 - 2.2, '#b8433a', 10)
  s.box(2.4, 0.9, 0.8, w * 0.1, 0.45, -d / 2 + 2.8, '#6b4a2f')
  s.box(0.7, 0.5, 0.5, w * 0.1, 1.15, -d / 2 + 2.8, '#3a3f46') // engine block
  // hand-painted sign on two poles
  s.box(0.12, 3.4, 0.12, -2, 1.7, d / 2 - 0.6, '#6b4a2f')
  s.box(0.12, 3.4, 0.12, 2, 1.7, d / 2 - 0.6, '#6b4a2f')
  s.box(5, 1.2, 0.1, 0, 3.0, d / 2 - 0.6, '#e8e4d8')
}

export interface CivicMeshes {
  /** one merged mesh per 768 m tile, so far-away sites can be culled */
  meshes: THREE.Mesh[]
  labels: { text: string; x: number; y: number; z: number; w: number; color: string }[]
}

// non-indexed, normal-carrying copy of each shared template, made once
const flatCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()
function flatOf(g: THREE.BufferGeometry, shared: boolean): THREE.BufferGeometry {
  if (shared) {
    let f = flatCache.get(g)
    if (!f) {
      f = g.index ? g.toNonIndexed() : g.clone()
      if (!f.attributes.normal) f.computeVertexNormals()
      flatCache.set(g, f)
    }
    return f
  }
  const f = g.index ? g.toNonIndexed() : g
  if (f !== g) g.dispose()
  if (!f.attributes.normal) f.computeVertexNormals()
  return f
}

export function buildCivic(): CivicMeshes | null {
  const sites = BAKE.civic ?? []
  if (!sites.length) return null
  const labels: CivicMeshes['labels'] = []
  // pass 1: collect parts with their final world matrix
  type Job = { hex: string; g: THREE.BufferGeometry; m: THREE.Matrix4 }
  const TILE = 768
  const tiles = new Map<string, { jobs: Job[]; total: number }>()
  const siteM = new THREE.Matrix4()
  for (const c of sites) {
    const s = new Site()
    if (c.kind === 'school') school(s, c)
    else if (c.kind === 'hospital') hospital(s, c)
    else if (c.kind === 'fuel') fuel(s, c)
    else mechanic(s, c)
    siteM.makeRotationY(c.yaw).setPosition(c.x, 0, c.z)
    const key = `${Math.floor(c.x / TILE)},${Math.floor(c.z / TILE)}`
    let tile = tiles.get(key)
    if (!tile) tiles.set(key, (tile = { jobs: [], total: 0 }))
    for (const [hex, g0, local] of s.parts) {
      const g = flatOf(g0, !!local)
      const m = local ? siteM.clone().multiply(local) : siteM.clone()
      tile.jobs.push({ hex, g, m })
      tile.total += g.attributes.position.count
    }
    const lx = 0
    const lz = c.d / 2 + 1
    const fx = c.x + lx * Math.cos(c.yaw) + lz * Math.sin(c.yaw)
    const fz = c.z - lx * Math.sin(c.yaw) + lz * Math.cos(c.yaw)
    const color = c.kind === 'hospital' ? '#ffd0d0' : c.kind === 'school' ? '#d8f0c8' : c.kind === 'fuel' ? '#fff2a8' : '#f0e0c8'
    const icon = c.kind === 'hospital' ? '🏥 ' : c.kind === 'school' ? '🏫 ' : c.kind === 'fuel' ? '⛽ ' : '🔧 '
    labels.push({ text: icon + c.name, x: fx, y: c.kind === 'hospital' ? 16 : c.kind === 'school' ? 9 : 8.5, z: fz, w: Math.min(40, 10 + c.name.length * 0.9), color })
  }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  const meshes: THREE.Mesh[] = []
  for (const { jobs, total } of tiles.values()) meshes.push(mergeTile(jobs, total, material))
  return { meshes, labels }
}

/** transform every vertex once, straight into one tile's merged arrays */
function mergeTile(jobs: { hex: string; g: THREE.BufferGeometry; m: THREE.Matrix4 }[], total: number, material: THREE.Material): THREE.Mesh {
  const pos = new Float32Array(total * 3)
  const nrm = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  const nm = new THREE.Matrix3()
  const tint = new THREE.Color()
  let off = 0
  for (const { hex, g, m } of jobs) {
    const P = g.attributes.position.array as ArrayLike<number>
    const N = g.attributes.normal.array as ArrayLike<number>
    const C = g.attributes.color?.array as ArrayLike<number> | undefined
    const n = g.attributes.position.count
    const e = m.elements
    nm.getNormalMatrix(m)
    const q = nm.elements
    const solid = hex !== '__keep' && !hex.startsWith('*')
    if (solid) tint.set(hex)
    else if (hex.startsWith('*')) tint.set(hex.slice(1))
    for (let i = 0; i < n; i++) {
      const i3 = i * 3
      const x = P[i3], y = P[i3 + 1], z = P[i3 + 2]
      const o = off + i3
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12]
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
      const a = N[i3], b = N[i3 + 1], cc = N[i3 + 2]
      let nx = q[0] * a + q[3] * b + q[6] * cc
      let ny = q[1] * a + q[4] * b + q[7] * cc
      let nz = q[2] * a + q[5] * b + q[8] * cc
      const l = Math.hypot(nx, ny, nz) || 1
      nrm[o] = nx / l
      nrm[o + 1] = ny / l
      nrm[o + 2] = nz / l
      if (solid || !C) {
        col[o] = tint.r
        col[o + 1] = tint.g
        col[o + 2] = tint.b
      } else {
        let r = C[i3], gr = C[i3 + 1], bl = C[i3 + 2]
        // vehicle with baked colours: tint only near-white body panels,
        // keep glass and tyres dark
        if (hex !== '__keep' && r > 0.85 && gr > 0.85 && bl > 0.85) {
          r *= tint.r
          gr *= tint.g
          bl *= tint.b
        }
        col[o] = r
        col[o + 1] = gr
        col[o + 2] = bl
      }
    }
    off += n * 3
    if (!flatCache.has(g)) g.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3))
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  const mesh = new THREE.Mesh(merged, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
