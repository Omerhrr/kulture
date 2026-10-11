<script setup lang="ts">
// KadunaCity - the full city map, rendered from the baked OSM-derived
// layout (scripts/kaduna-osm/bake_kaduna.py). Everything merges into a
// handful of vertex-colored meshes so the whole city costs a few draw
// calls. Authored landmarks (stadium, mosque, market, refinery...) are
// low-poly stand-ins placed at their real OSM positions.
//
// The server-owned playable entities (shops, kiosk, plaza...) are NOT
// here: WorldScene renders those at the positions the backend owns.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BAKE, BRIDGE_NAMES } from '~/utils/kaduna'
import { makeLabelTexture } from '~/utils/sign'

// ---------------------------------------------------------------- helpers
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(0x4d4144)

const bucketColor: Record<string, string> = {
  wall: '#c9b18a',
  roof: '#b04a3a',
  stone: '#9a9aa2',
  white: '#e8e4d8',
  metal: '#b8bcc4',
  dark: '#3b3b40',
  green: '#4f7d3f',
  sand: '#c9b78e',
  water: '#3f6f85',
  water_bank: '#c9b78e',
  asphalt: '#43434a',
  trunk: '#7a5c3a',
  leaf: '#4f7d3f',
  gold: '#d8b13c',
  rust: '#8a5a3a'
}

type Buckets = Record<string, THREE.BufferGeometry[]>

function buildCity(): {
  meshes: { geometry: THREE.BufferGeometry; color: string; cast: boolean }[]
  sprites: { texture: THREE.CanvasTexture; x: number; y: number; z: number; w: number; h: number }[]
  group: THREE.Group
} {
  const buckets: Buckets = {}
  const sprites: { texture: THREE.CanvasTexture; x: number; y: number; z: number; w: number; h: number }[] = []

  function push(bucket: string, geo: THREE.BufferGeometry, color?: string) {
    // mergeGeometries needs uniform layouts: drop indices + uv everywhere
    const g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    g.deleteAttribute('uv')
    const c = new THREE.Color(color ?? bucketColor[bucket] ?? '#cccccc')
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    ;(buckets[bucket] ??= []).push(g)
  }

  const box = (b: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, color?: string) => {
    const g = new THREE.BoxGeometry(w, h, d)
    if (ry) g.rotateY(ry)
    g.translate(x, y, z)
    push(b, g, color)
    return g
  }
  const cyl = (b: string, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color?: string) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg)
    g.translate(x, y, z)
    push(b, g, color)
    return g
  }
  const cone = (b: string, r: number, h: number, seg: number, x: number, y: number, z: number, ry = 0, color?: string) => {
    const g = new THREE.ConeGeometry(r, h, seg)
    if (ry) g.rotateY(ry)
    g.translate(x, y, z)
    push(b, g, color)
    return g
  }
  const sphere = (b: string, r: number, x: number, y: number, z: number, color?: string) => {
    const g = new THREE.SphereGeometry(r, 14, 10)
    g.translate(x, y, z)
    push(b, g, color)
  }
  const dome = (b: string, r: number, x: number, y: number, z: number, color?: string) => {
    const g = new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)
    g.translate(x, y, z)
    push(b, g, color)
  }

  /** Ribbon along a polyline (roads / rivers / rails / runway). */
  function ribbon(bucket: string, pts: [number, number][], width: number, color?: string, y = 0.05) {
    if (pts.length < 2) return
    const pos: number[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az) || 1
      const nx = (-(bz - az) / len) * (width / 2)
      const nz = ((bx - ax) / len) * (width / 2)
      const quad = [
        [ax + nx, az + nz],
        [ax - nx, az - nz],
        [bx - nx, bz - nz],
        [ax + nx, az + nz],
        [bx - nx, bz - nz],
        [bx + nx, bz + nz]
      ]
      for (const [x, z] of quad) pos.push(x, y, z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    push(bucket, g, color)
  }

  function label(text: string, x: number, y: number, z: number, w: number, color?: string) {
    sprites.push({ texture: makeLabelTexture(text, color), x, y, z, w, h: w * 0.1875 })
  }

  // ---------------------------------------------------------------- ground
  push('sand', (() => {
    const g = new THREE.PlaneGeometry(3400, 3000)
    g.rotateX(-Math.PI / 2)
    g.translate(-350, -0.12, 200)
    return g
  })())

  // ---------------------------------------------------------------- river
  const river = BAKE.river
  ribbon('water_bank', river.main, river.width + 9, undefined, 0.02)
  ribbon('water', river.main, river.width, undefined, 0.06)
  for (const s of river.side) {
    ribbon('water_bank', s, river.width * 0.7 + 7, undefined, 0.02)
    ribbon('water', s, river.width * 0.7, undefined, 0.06)
  }

  // ---------------------------------------------------------------- roads
  const roadWidth = (cls: string) => (cls === 'trunk' ? 3.2 : cls === 'primary' ? 2.6 : 1.8)
  for (const r of BAKE.roads) {
    ribbon('asphalt', r.pts, roadWidth(r.class), undefined, 0.04)
    if (r.class === 'trunk' || r.class === 'primary') {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i]
        const [bx, bz] = r.pts[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        const n = Math.max(1, Math.floor(len / 9))
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n
          box('gold', 0.28, 0.02, 1.6, ax + (bx - ax) * t, 0.09, az + (bz - az) * t, Math.atan2(bz - az, bx - ax))
        }
      }
    }
  }

  // ---------------------------------------------------------------- rail
  for (const line of BAKE.rail) {
    ribbon('dark', line, 1.7, undefined, 0.05)
    ribbon('metal', line, 0.14, undefined, 0.12)
  }

  // ---------------------------------------------------------------- airport
  const ap = BAKE.airport
  if (ap.runway && ap.runway.length >= 2) {
    ribbon('stone', ap.runway, 5.4, undefined, 0.04)
    for (let i = 0; i < ap.runway.length - 1; i++) {
      const [ax, az] = ap.runway[i]
      const [bx, bz] = ap.runway[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.floor(len / 7))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        box('white', 0.3, 0.02, 2.2, ax + (bx - ax) * t, 0.09, az + (bz - az) * t, Math.atan2(bz - az, bx - ax))
      }
    }
    // terminal + control tower + parked jet
    const rx = ap.runway[0][0]
    const rz = ap.runway[0][1]
    box('white', 26, 4.5, 10, rx - 12, 2.25, rz + 14)
    box('metal', 27, 0.5, 11, rx - 12, 4.7, rz + 14)
    cyl('white', 1.1, 1.5, 9, 8, rx + 8, 4.5, rz + 14)
    cyl('dark', 2.2, 2.2, 1, 8, rx + 8, 9.3, rz + 14)
    // jet
    const fus = cyl('white', 0.9, 1.2, 11, 10, rx - 20, 2.1, rz - 4, '#dfe3ea')
    fus.rotateZ(Math.PI / 2)
    box('metal', 9, 0.25, 1.7, rx - 20, 2.3, rz - 4)
    const tail = cone('metal', 1.1, 2.2, 6, rx - 25.6, 2.6, rz - 4, 0, '#b8bcc4')
    tail.rotateZ(Math.PI / 2)
    const nose = cone('metal', 0.9, 1.6, 6, rx - 14.4, 2.6, rz - 4, 0, '#b8bcc4')
    nose.rotateZ(-Math.PI / 2)
  }
  if (ap.apron) {
    box('stone', ap.apron.w, 0.06, ap.apron.d, ap.apron.x, 0.03, ap.apron.z)
  }

  // ---------------------------------------------------------------- houses
  const walls = BAKE.housePalettes.wall
  const roofs = BAKE.housePalettes.roof
  for (const [x, z, w, d, rot, ci, ri] of BAKE.houses) {
    const hh = 2.6 + (ci % 3) * 0.5
    box('wall', w, hh, d, x, hh / 2, z, rot, walls[ci])
    cone('roof', Math.max(w, d) * 0.72, 1.7, 4, x, hh + 0.85, z, rot + Math.PI / 4, roofs[ri])
  }

  // ---------------------------------------------------------------- trees
  for (const [x, z, s] of BAKE.trees) {
    cyl('trunk', 0.16 * s, 0.26 * s, 2.6 * s, 6, x, 1.3 * s, z)
    cone('leaf', 1.5 * s, 2.6 * s, 7, x, 3.4 * s, z, 0)
    cone('leaf', 1.9 * s, 2.0 * s, 7, x, 2.6 * s, z, 0, '#5d8a46')
  }

  // ---------------------------------------------------------------- landmarks
  for (const lm of BAKE.landmarks) {
    const { x, z, kind } = lm
    switch (kind) {
      case 'square': {
        cyl('stone', 26, 26, 0.14, 36, x, 0.07, z, '#b0a88f')
        cyl('white', 2.4, 3.2, 1.4, 12, x, 0.7, z, '#ded8c8')
        cyl('white', 0.22, 0.3, 16, 8, x, 8.7, z)
        box('green', 3.4, 2.1, 0.2, x + 0.8, 15.6, z)
        cyl('stone', 1.2, 1.4, 2.6, 8, x - 8, 1.3, z - 8, '#8d8d94')
        for (const [tx, tz] of [[-14, 10], [12, -12], [-12, -14], [14, 12]] as const) {
          cyl('trunk', 0.2, 0.3, 3, 6, x + tx, 1.5, z + tz)
          cone('leaf', 1.6, 2.8, 7, x + tx, 3.6, z + tz)
        }
        break
      }
      case 'market': {
        // large open shed grid, the biggest market this side of the Niger
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 6; c++) {
            const sx = x - 21 + c * 8.4
            const sz = z - 12 + r * 8
            box('wall', 6.4, 2.6, 5.2, sx, 1.3, sz, 0, '#5d6e46')
            box('roof', 7.2, 0.3, 6.2, sx, 2.85, sz, 0, r % 2 ? '#b8433a' : '#e8b84b')
          }
        }
        box('stone', 46, 0.1, 34, x, 0.06, z, 0, '#a89f85')
        break
      }
      case 'stadium': {
        const g1 = new THREE.CylinderGeometry(20, 22, 4.5, 30, 1, true)
        g1.translate(x, 2.25, z)
        push('stone', g1, '#b7b4ab')
        const g2 = new THREE.CylinderGeometry(15.5, 15.5, 0.2, 24)
        g2.translate(x, 0.35, z)
        push('green', g2, '#4f8f45')
        cyl('dark', 0.3, 0.45, 15, 6, x - 13, 7.5, z - 13)
        cyl('dark', 0.3, 0.45, 15, 6, x + 13, 7.5, z - 13)
        cyl('dark', 0.3, 0.45, 15, 6, x - 13, 7.5, z + 13)
        cyl('dark', 0.3, 0.45, 15, 6, x + 13, 7.5, z + 13)
        box('white', 8, 2.4, 3, x, 1.2, z + 22.5)
        break
      }
      case 'cathedral': {
        box('white', 9, 7, 20, x, 3.5, z)
        const roofG = new THREE.CylinderGeometry(0.01, 4.6, 3.4, 4)
        roofG.rotateY(Math.PI / 4)
        roofG.translate(x, 8.7, z)
        push('roof', roofG, '#7d4a3a')
        box('white', 3.2, 11, 3.2, x - 5.6, 5.5, z - 8)
        box('white', 3.2, 11, 3.2, x + 5.6, 5.5, z - 8)
        cone('roof', 2.3, 2.6, 4, x - 5.6, 12.3, z - 8, 0, '#7d4a3a')
        cone('roof', 2.3, 2.6, 4, x + 5.6, 12.3, z - 8, 0, '#7d4a3a')
        box('gold', 0.16, 1.6, 0.16, x, 11.4, z + 9.6)
        box('gold', 0.9, 0.16, 0.16, x, 11.6, z + 9.6)
        break
      }
      case 'mosque': {
        box('white', 26, 6, 20, x, 3, z, 0, '#e6ded0')
        dome('gold', 7.5, x, 6, z, '#2f7d5b')
        cyl('white', 1.5, 1.9, 19, 10, x - 11, 9.5, z + 8, '#e6ded0')
        cyl('white', 1.5, 1.9, 19, 10, x + 11, 9.5, z + 8, '#e6ded0')
        cone('gold', 1.9, 3, 8, x - 11, 20.5, z + 8, 0, '#2f7d5b')
        cone('gold', 1.9, 3, 8, x + 11, 20.5, z + 8, 0, '#2f7d5b')
        box('stone', 34, 0.12, 28, x, 0.06, z, 0, '#a89f85')
        break
      }
      case 'golf': {
        for (let i = 0; i < 5; i++) {
          const gx = x + (rand() - 0.5) * 90
          const gz = z + (rand() - 0.5) * 70
          cyl('green', 6 + rand() * 8, 6 + rand() * 8, 0.08, 14, gx, 0.05, gz, '#5d9a4c')
        }
        box('white', 9, 3.4, 6, x, 1.7, z, 0, '#e0d8c4')
        box('roof', 10, 0.4, 7, x, 3.7, z)
        break
      }
      case 'govhouse': {
        box('white', 22, 6.5, 12, x, 3.25, z, 0, '#efe9dc')
        box('roof', 23, 0.5, 13, x, 6.9, z)
        box('white', 12, 4, 8, x, 2, z - 14)
        box('green', 40, 2.2, 0.4, x, 1.1, z + 18, 0, '#3f6f3a')
        box('gold', 6, 3.2, 0.3, x, 1.6, z + 18, 0, '#d8b13c')
        break
      }
      case 'museum': {
        box('white', 12, 4.2, 8, x, 2.1, z)
        cyl('white', 4.5, 4.5, 3.4, 14, x + 9, 1.7, z + 2)
        dome('stone', 4.7, x + 9, 3.4, z + 2, '#b7b4ab')
        break
      }
      case 'hotel': {
        box('white', 9, 15, 9, x, 7.5, z, 0, '#e8ddc8')
        box('metal', 9.6, 0.6, 9.6, x, 15.4, z)
        box('water', 7, 0.15, 4.5, x + 9, 0.1, z + 7)
        box('sand', 9, 0.1, 6.5, x + 9, 0.05, z + 7, 0, '#d8cba0')
        break
      }
      case 'mast': {
        box('white', 8, 3.6, 6, x, 1.8, z)
        cyl('metal', 0.16, 0.3, 26, 6, x, 15, z)
        cyl('rust', 0.34, 0.34, 1.1, 6, x, 22, z, '#c94a3a')
        cyl('white', 0.34, 0.34, 1.1, 6, x, 23.4, z)
        cyl('rust', 0.34, 0.34, 1.1, 6, x, 24.8, z, '#c94a3a')
        break
      }
      case 'campus': {
        for (let i = 0; i < 4; i++) {
          const bx = x + (i % 2 === 0 ? -14 : 12) + (i > 1 ? 4 : 0)
          const bz = z + (i < 2 ? -10 : 10)
          box('white', 13, 4.6, 8, bx, 2.3, bz, 0, '#e8e2d2')
          box('roof', 14, 0.4, 9, bx, 4.9, bz, 0, '#8a5a3a')
        }
        box('green', 30, 0.08, 18, x, 0.05, z, 0, '#5d9a4c')
        break
      }
      case 'hospital': {
        box('white', 16, 8.5, 9, x, 4.25, z, 0, '#eef0ea')
        box('white', 9, 6, 9, x - 11, 3, z + 5, 0, '#eef0ea')
        box('metal', 16.6, 0.4, 9.6, x, 8.8, z)
        box('rust', 1.2, 2.2, 0.3, x, 2.2, z + 4.6, 0, '#c94a3a')
        break
      }
      case 'park': {
        box('stone', 12, 5.5, 4, x, 2.75, z, 0, '#a89a7a')
        const arch = new THREE.TorusGeometry(4.4, 0.55, 8, 14, Math.PI)
        arch.translate(x, 5.5, z)
        push('stone', arch, '#a89a7a')
        box('green', 40, 0.08, 26, x - 24, 0.05, z + 4, 0, '#5d9a4c')
        break
      }
      case 'motorpark': {
        box('roof', 24, 0.4, 12, x, 4.4, z, 0, '#8a8f96')
        for (let i = 0; i < 4; i++) {
          cyl('metal', 0.22, 0.22, 4.2, 6, x - 10 + i * 7, 2.1, z - 5)
          cyl('metal', 0.22, 0.22, 4.2, 6, x - 10 + i * 7, 2.1, z + 5)
        }
        for (let i = 0; i < 5; i++) {
          box('gold', 4.6, 2.4, 2, x - 9 + i * 4.6, 1.2, z + 8 + (i % 2) * 3.4, 0.3 * (i % 3), '#d8c23c')
        }
        break
      }
      case 'station':
      case 'junction': {
        const big = kind === 'junction'
        box('wall', 18, 6.5, 8, x, 3.25, z + 6, 0, '#c9b18a')
        box('roof', 19, 0.5, 9, x, 6.9, z + 6, 0, '#7d5a4a')
        if (big) {
          box('wall', 5, 11, 5, x, 5.5, z + 6, 0, '#b8a488')
          cone('roof', 3.6, 2.8, 4, x, 12.4, z + 6, Math.PI / 4, '#6b4a3f')
          cyl('white', 1.1, 1.1, 0.5, 10, x, 11.2, z + 8.6)
        }
        box('stone', 30, 0.3, 3, x, 0.6, z, 0, '#8a8f96')
        box('metal', 30, 0.3, 0.5, x, 1.05, z - 1.2)
        box('metal', 30, 0.3, 0.5, x, 1.05, z + 1.2)
        // train consist
        for (let i = 0; i < 3; i++) {
          box('green', 9, 3.2, 2.6, x - 10 + i * 10, 1.9, z - 2.6, 0, i === 0 ? '#3f6f3a' : '#d8c23c')
          box('dark', 9.4, 0.4, 2.8, x - 10 + i * 10, 0.5, z - 2.6)
        }
        break
      }
      case 'military': {
        box('sand', 70, 0.08, 46, x, 0.05, z, 0, '#b5a26b')
        for (let i = 0; i < 5; i++) {
          box('white', 12, 4, 7, x - 24 + i * 12, 2, z - 16, 0, '#d8d4c4')
        }
        box('green', 5, 3.4, 0.4, x, 1.7, z + 22, 0, '#3f6f3a')
        cyl('white', 0.2, 0.26, 9, 6, x + 26, 4.5, z + 18)
        break
      }
      case 'refinery': {
        for (let i = 0; i < 6; i++) {
          const tx = x - 40 + (i % 3) * 22
          const tz = z - 20 + Math.floor(i / 3) * 26
          cyl('metal', 7, 7, 8, 16, tx, 4, tz, '#c8ccd2')
          dome('metal', 7, tx, 8, tz, '#d8dce2')
        }
        cyl('metal', 1.6, 2.2, 22, 10, x + 34, 11, z - 24, '#b8bcc4')
        cyl('metal', 2.4, 2.4, 14, 10, x + 42, 7, z - 10, '#a8acb2')
        cyl('rust', 0.5, 0.7, 30, 6, x - 52, 15, z + 26, '#8a5a3a')
        sphere('gold', 1.4, x - 52, 31, z + 26, '#f0a03a')
        break
      }
      case 'factory': {
        for (let i = 0; i < 3; i++) {
          box('wall', 26, 6, 12, x - 28 + i * 28, 3, z, 0, '#9a8a72')
          for (let s = 0; s < 5; s++) {
            const saw = new THREE.CylinderGeometry(0.01, 2.8, 2.6, 4)
            saw.rotateY(Math.PI / 4)
            saw.translate(x - 38 + i * 28 + s * 5.4, 6.9, z)
            push('roof', saw, '#6b7280')
          }
        }
        cyl('rust', 1.1, 1.5, 20, 8, x + 34, 10, z + 8, '#8a5a3a')
        break
      }
      case 'estate': {
        box('stone', 120, 2, 0.5, x, 1, z - 40, 0, '#b7b4ab')
        for (let i = 0; i < 12; i++) {
          const hx = x - 48 + (i % 4) * 30
          const hz = z - 22 + Math.floor(i / 4) * 20
          box('white', 9, 3.6, 7, hx, 1.8, hz, 0, '#efe9dc')
          cone('roof', 6.4, 2, 4, hx, 4.6, hz, Math.PI / 4, '#b04a3a')
        }
        box('gold', 7, 3.4, 0.4, x, 1.7, z - 40, 0, '#d8b13c')
        break
      }
      case 'sign': {
        cyl('trunk', 0.24, 0.3, 7, 6, x, 3.5, z)
        box('green', 8.5, 2.4, 0.3, x, 7.4, z, 0, '#1e5c38')
        break
      }
    }
    if (lm.lh > 0) label(lm.name, x, lm.lh, z, Math.min(34, 12 + lm.name.length * 0.85))
  }

  // ---------------------------------------------------------------- bridges
  for (const b of BAKE.bridges) {
    const name = BRIDGE_NAMES[b.name] ?? b.name
    box('stone', Math.abs(b.w) + 2.2, 1.1, 26, b.x, 0.75, b.z, b.rot, '#9a948a')
    box('metal', 0.35, 1.0, 26, b.x, 1.8, b.z, b.rot)
    if (name === 'Coronation Bridge') {
      const arch = new THREE.TorusGeometry(11, 0.7, 8, 18, Math.PI)
      arch.rotateY(b.rot + Math.PI / 2)
      arch.translate(b.x, 1.2, b.z)
      push('stone', arch, '#9a948a')
    }
    label(name, b.x, 9, b.z, 18, '#ffe9a8')
  }

  // ---------------------------------------------------------------- labels
  for (const p of BAKE.places) {
    label(p.name, p.x, 13, p.z, 15, '#f5f2e8')
  }
  label('River Kaduna', 350, 14, -30, 16, '#bfe3ef')
  label('to Zaria 88km', 175, 8, -930, 13, '#e8e4d8')
  label('to Jos 230km', 300, 8, -1000, 13, '#e8e4d8')
  label('to Abuja 210km', -600, 8, 1420, 13, '#e8e4d8')
  label('Kajuru Road - Kajuru Castle 42km', 250, 9.5, 1120, 15, '#e8e4d8')

  // ---------------------------------------------------------------- merge
  const meshes: { geometry: THREE.BufferGeometry; color: string; cast: boolean }[] = []
  const castBuckets = new Set(['wall', 'roof', 'stone', 'white', 'metal', 'dark', 'green'])
  for (const [bucket, geos] of Object.entries(buckets)) {
    if (!geos.length) continue
    const merged = mergeGeometries(geos, false)
    if (merged) {
      merged.computeBoundingSphere()
      if (!Number.isFinite(merged.boundingSphere?.radius ?? NaN)) {
        console.error(`[KadunaCity] bucket "${bucket}" has NaN positions`)
      }
      meshes.push({ geometry: merged, color: bucketColor[bucket] ?? '#cccccc', cast: castBuckets.has(bucket) })
    }
    for (const g of geos) g.dispose()
  }
  return { meshes, sprites, group: new THREE.Group() }
}

// Built lazily on the client (label textures need the DOM; this component
// only ever mounts inside <ClientOnly>). Built once per session.
let cityCache: ReturnType<typeof buildCity> | null = null
function getCity() {
  if (!cityCache) cityCache = buildCity()
  return cityCache
}

const cityRef = shallowRef<ReturnType<typeof buildCity> | null>(null)
onMounted(() => {
  try {
    cityRef.value = getCity()
  } catch (e) {
    ;(window as any).__kk_city_err = String((e as Error)?.stack || e)
    throw e
  }
})
</script>

<template>
  <TresGroup v-if="cityRef">
    <TresMesh
      v-for="(m, i) in cityRef.meshes"
      :key="'km' + i"
      :geometry="m.geometry"
      cast-shadow
      receive-shadow
    >
      <TresMeshLambertMaterial :color="m.color" :vertex-colors="true" />
    </TresMesh>
    <TresSprite v-for="(s, i) in cityRef.sprites" :key="'ks' + i" :position="[s.x, s.y, s.z]" :scale="[s.w, s.h, 1]">
      <TresSpriteMaterial :map="s.texture" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
