// Public buildings: schools, hospitals, filling stations and mechanic
// workshops. Sites are placed by kaduna.ts (densify); this module turns
// them into one merged vertex-coloured mesh + name boards.
import * as THREE from 'three'
import { BAKE, type CivicSite } from './kaduna'
import { vehicleSpec } from './vehicles'

type Part = [string, THREE.BufferGeometry]

function colorize(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const gg = g.index ? g.toNonIndexed() : g
  if (gg !== g) g.dispose()
  if (gg.attributes.uv) gg.deleteAttribute('uv')
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
}

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
    const c = g.clone()
    if (ry) c.rotateY(ry)
    c.translate(x, y, z)
    this.parts.push([hex ? '*' + hex : '__keep', c])
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
  s.geo(vehicleSpec('car').geo, '#b8433a', -cw / 4 + 2.2, 0, 2, 0)
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
  s.geo(vehicleSpec('car').geo, '#8a8f96', -w * 0.22, 0.35, -d / 2 + 5.5, Math.PI / 2)
  s.box(0.5, 0.35, 0.5, -w * 0.22 - 1.3, 0.18, -d / 2 + 5.5, '#4a4a50')
  s.box(0.5, 0.35, 0.5, -w * 0.22 + 1.3, 0.18, -d / 2 + 5.5, '#4a4a50')
  s.geo(vehicleSpec('car').geo, '#3f6fae', w * 0.2, 0, 0.5, 0.3)
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
  mesh: THREE.Mesh
  labels: { text: string; x: number; y: number; z: number; w: number; color: string }[]
}

export function buildCivic(): CivicMeshes | null {
  const sites = BAKE.civic ?? []
  if (!sites.length) return null
  const geos: THREE.BufferGeometry[] = []
  const labels: CivicMeshes['labels'] = []
  for (const c of sites) {
    const s = new Site()
    if (c.kind === 'school') school(s, c)
    else if (c.kind === 'hospital') hospital(s, c)
    else if (c.kind === 'fuel') fuel(s, c)
    else mechanic(s, c)
    for (const [hex, g] of s.parts) {
      let gg: THREE.BufferGeometry
      if (hex === '__keep') {
        gg = g.index ? g.toNonIndexed() : g
      } else if (hex.startsWith('*')) {
        // vehicle with baked colours: tint the body (multiply)
        gg = g.index ? g.toNonIndexed() : g
        const t = new THREE.Color(hex.slice(1))
        const a = gg.attributes.color.array as Float32Array
        for (let i = 0; i < a.length; i += 3) {
          // only tint near-white body panels, keep glass/tyres dark
          if (a[i] > 0.85 && a[i + 1] > 0.85 && a[i + 2] > 0.85) {
            a[i] *= t.r
            a[i + 1] *= t.g
            a[i + 2] *= t.b
          }
        }
      } else {
        gg = colorize(g, hex)
      }
      // vehicle geometries carry their own colours but no normals tweak
      if (!gg.attributes.normal) gg.computeVertexNormals()
      gg.rotateY(c.yaw)
      gg.translate(c.x, 0, c.z)
      // keep only the attributes every part shares
      for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') gg.deleteAttribute(k)
      geos.push(gg)
    }
    // tinted vehicle copies: multiply their baked colour
    const lx = 0
    const lz = c.d / 2 + 1
    const fx = c.x + lx * Math.cos(c.yaw) + lz * Math.sin(c.yaw)
    const fz = c.z - lx * Math.sin(c.yaw) + lz * Math.cos(c.yaw)
    const color = c.kind === 'hospital' ? '#ffd0d0' : c.kind === 'school' ? '#d8f0c8' : c.kind === 'fuel' ? '#fff2a8' : '#f0e0c8'
    const icon = c.kind === 'hospital' ? '🏥 ' : c.kind === 'school' ? '🏫 ' : c.kind === 'fuel' ? '⛽ ' : '🔧 '
    labels.push({ text: icon + c.name, x: fx, y: c.kind === 'hospital' ? 16 : c.kind === 'school' ? 9 : 8.5, z: fz, w: Math.min(40, 10 + c.name.length * 0.9), color })
  }
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0)
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
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3))
  merged.computeBoundingSphere()
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  return { mesh, labels }
}
