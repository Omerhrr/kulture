<script setup lang="ts">
// KadunaCity v3 - the living city. Still one merged vertex-colored mesh per
// material bucket, now grouped into 512-unit tiles so frustum culling and a
// distance fade keep the draw calls low across the 21 x 24 km map.
//
// What v3 adds over the first pass:
//  - savanna-green ground with painted variation instead of a sand sheet
//  - taller, varied houses (1-2 stories, flat or pitched roofs) in Nigerian
//    wall palettes, every one with a door facing the nearest road + windows
//  - four tree species (neem, mango, palm, baobab) at up to 3x human height,
//    plus riverbank and roadside planting so the city reads green
//  - a CBD tower cluster, fadama farms along the river, outskirt fields,
//    the dam + reservoir upstream, the Romi stream, animated river water
//  - market stall goods + umbrellas, flower gardens, a football pitch,
//    streetlights and two building construction sites

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BAKE, BRIDGE_NAMES } from '~/utils/kaduna'
import {
  TOWERS,
  FARMS,
  DAM,
  ROMI,
  SITES,
  hash01,
  hashDist,
  roadHash,
  houseHash,
  waterHash
} from '~/utils/kadunaExtras'
import { makeLabelTexture } from '~/utils/sign'

const rand = (() => {
  let a = 0x4d4144
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    const t = Math.imul(a ^ (a >>> 15), 1 | a)
    return (((t ^ (t >>> 7)) ^ t) >>> 0) / 4294967296
  }
})()

const bucketColor: Record<string, string> = {
  wall: '#c9b18a',
  roof: '#b04a3a',
  stone: '#9a9aa2',
  white: '#e8e4d8',
  metal: '#b8bcc4',
  dark: '#3b3b40',
  green: '#4f7d3f',
  green2: '#5d9a4c',
  sand: '#c9b78e',
  water: '#3f6f85',
  water_bank: '#c9b78e',
  asphalt: '#43434a',
  trunk: '#7a5c3a',
  leaf: '#4f7d3f',
  leaf2: '#5d8a46',
  gold: '#d8b13c',
  rust: '#8a5a3a',
  door: '#4a3524',
  window: '#26323e',
  glass: '#8fb6c4',
  concrete: '#c8c4b8',
  soil: '#7a5c38',
  crop1: '#8fae4a',
  crop2: '#4f8f3f',
  crop3: '#6fae4a',
  flower1: '#d86a8a',
  flower2: '#e8c84a',
  flower3: '#9a6ad8',
  blue: '#3f6fae',
  line: '#f0eee6'
}

// Nigerian wall palette (no red walls - that was the v2 complaint) and a
// roof palette where red is a deliberate minority.
const WALLS = ['#e8dcc4', '#ece8dc', '#e9d78f', '#bcd8e0', '#a8b89a', '#c47a52', '#d8c8a0', '#e0b89a', '#c8c8c2', '#b8d4c0']
const ROOFS_PITCH = ['#8a4a3a', '#6b7280', '#b04a3a', '#5d6e46', '#7d5a4a']
const ROOFS_FLAT = ['#b8b4a8', '#9aa0a6', '#c8beb0', '#8a9298']
const UMBRELLAS = ['#c94a3a', '#e8b84b', '#3f7d5b', '#3f6fae']

type Buckets = Record<string, THREE.BufferGeometry[]>

interface TileMesh {
  geometry: THREE.BufferGeometry
  color: string
  cast: boolean
  cx: number
  cz: number
}

function buildCity(): {
  meshes: TileMesh[]
  sprites: { texture: THREE.CanvasTexture; x: number; y: number; z: number; w: number; h: number }[]
  water: THREE.BufferGeometry[]
  waterTexture: THREE.CanvasTexture
  waterMaterial: THREE.MeshBasicMaterial
} {
  const buckets: Buckets = {}
  const waterGeos: THREE.BufferGeometry[] = []
  const sprites: { texture: THREE.CanvasTexture; x: number; y: number; z: number; w: number; h: number }[] = []

  function push(bucket: string, geo: THREE.BufferGeometry, color?: string, keepColor = false) {
    const g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    if (g.attributes.uv) g.deleteAttribute('uv')
    if (!keepColor) {
      const c = new THREE.Color(color ?? bucketColor[bucket] ?? '#cccccc')
      const n = g.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    ;(buckets[bucket] ??= []).push(g)
  }

  const box = (b: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, color?: string) => {
    const g = new THREE.BoxGeometry(w, h, d)
    if (ry) g.rotateY(ry)
    g.translate(x, y, z)
    push(b, g, color)
  }
  const cyl = (b: string, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color?: string) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg)
    g.translate(x, y, z)
    push(b, g, color)
  }
  const cone = (b: string, r: number, h: number, seg: number, x: number, y: number, z: number, ry = 0, color?: string) => {
    const g = new THREE.ConeGeometry(r, h, seg)
    if (ry) g.rotateY(ry)
    g.translate(x, y, z)
    push(b, g, color)
  }
  const sphere = (b: string, r: number, x: number, y: number, z: number, color?: string) => {
    const g = new THREE.SphereGeometry(r, 12, 9)
    g.translate(x, y, z)
    push(b, g, color)
  }
  const dome = (b: string, r: number, x: number, y: number, z: number, color?: string) => {
    const g = new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)
    g.translate(x, y, z)
    push(b, g, color)
  }

  /** Ribbon along a polyline (roads / banks / water). */
  function ribbon(bucket: string, pts: [number, number][], width: number, color?: string, y = 0.05, keepColor = false) {
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
    push(bucket, g, color, keepColor)
  }

  function label(text: string, x: number, y: number, z: number, w: number, color?: string) {
    sprites.push({ texture: makeLabelTexture(text, color), x, y, z, w, h: w * 0.1875 })
  }

  // ---------------------------------------------------------------- ground
  // subdivided savanna: base greens, dry patches, lush band near water
  {
    const g = new THREE.PlaneGeometry(3600, 3200, 72, 64)
    g.rotateX(-Math.PI / 2)
    g.translate(-350, -0.12, 200)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const lush = new THREE.Color('#5d8a46')
    const base1 = new THREE.Color('#84a55e')
    const base2 = new THREE.Color('#6f9448')
    const dry = new THREE.Color('#b0a870')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const n = hash01(x * 0.11, z * 0.11) * 0.6 + hash01(x * 0.031, z * 0.031, 3) * 0.4
      c.copy(base1).lerp(base2, n)
      const dryN = hash01(x * 0.021, z * 0.021, 7)
      if (dryN > 0.72) c.lerp(dry, Math.min(1, (dryN - 0.72) * 3))
      const wd = hashDist(waterHash(), x, z, 120)
      if (wd < 46) c.lerp(lush, 1 - wd / 46)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // toNonIndexed expands every attribute (color included) per face
    const flat = g.toNonIndexed()
    flat.deleteAttribute('uv')
    g.dispose()
    ;(buckets.grass ??= []).push(flat)
  }

  // ---------------------------------------------------------------- river
  const river = BAKE.river
  ribbon('water_bank', river.main, river.width + 9, undefined, 0.02)
  for (const s of river.side) {
    ribbon('water_bank', s, river.width * 0.7 + 7, undefined, 0.02)
    ribbon('water', s, river.width * 0.7, undefined, 0.06)
  }
  // animated water: main stem + reservoir + Romi stream
  waterGeos.push(ribbonGeo(river.main, river.width, 0.06))
  waterGeos.push(ribbonGeo(river.main.slice(0, DAM.idx + 1), river.width * 2.1, 0.12))
  waterGeos.push(ribbonGeo(ROMI.pts, 4.6, 0.06))
  ribbon('water_bank', ROMI.pts, 9.6, undefined, 0.02)

  function ribbonGeo(pts: [number, number][], width: number, y: number): THREE.BufferGeometry {
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
    return g
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

  // streetlights along the main roads
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
        cyl('metal', 0.07, 0.1, 4.6, 6, x + ox, 2.3, z + oz)
        const a = Math.atan2(-ox, -oz)
        const armG = new THREE.BoxGeometry(0.09, 0.09, 1.5)
        armG.rotateY(a)
        armG.translate(x + ox - Math.sin(a) * 0.7, 4.55, z + oz - Math.cos(a) * 0.7)
        push('metal', armG)
        const headG = new THREE.BoxGeometry(0.5, 0.14, 0.26)
        headG.rotateY(a)
        headG.translate(x + ox - Math.sin(a) * 1.4, 4.5, z + oz - Math.cos(a) * 1.4)
        push('dark', headG)
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
    const rx = ap.runway[0][0]
    const rz = ap.runway[0][1]
    box('white', 26, 4.5, 10, rx - 12, 2.25, rz + 14)
    box('metal', 27, 0.5, 11, rx - 12, 4.7, rz + 14)
    cyl('white', 1.1, 1.5, 9, 8, rx + 8, 4.5, rz + 14)
    cyl('dark', 2.2, 2.2, 1, 8, rx + 8, 9.3, rz + 14)
    // parked jet (the rideable one lives in RideSystem)
    const fus = new THREE.CylinderGeometry(0.9, 1.2, 11, 10)
    fus.rotateZ(Math.PI / 2)
    fus.translate(rx - 20, 2.1, rz - 4)
    push('white', fus, '#dfe3ea')
    box('metal', 9, 0.25, 1.7, rx - 20, 2.3, rz - 4)
    const tail = new THREE.ConeGeometry(1.1, 2.2, 6)
    tail.rotateZ(Math.PI / 2)
    tail.translate(rx - 25.6, 2.6, rz - 4)
    push('metal', tail, '#b8bcc4')
    const nose = new THREE.ConeGeometry(0.9, 1.6, 6)
    nose.rotateZ(-Math.PI / 2)
    nose.translate(rx - 14.4, 2.6, rz - 4)
    push('metal', nose, '#b8bcc4')
  }
  if (ap.apron) {
    box('stone', ap.apron.w, 0.06, ap.apron.d, ap.apron.x, 0.03, ap.apron.z)
  }

  // ---------------------------------------------------------------- houses
  const nWalls = WALLS.length
  for (const [x, z, w, d, rot, ci, ri] of BAKE.houses) {
    const h1 = hash01(x, z)
    const h2 = hash01(x, z, 11)
    const h3 = hash01(x, z, 23)
    const twoStory = h1 < 0.26
    const hh = twoStory ? 6.0 : 3.4 + (ci % 3) * 0.35
    const wall = WALLS[(ci + Math.floor(h2 * nWalls)) % nWalls]

    box('wall', w, hh, d, x, hh / 2, z, rot, wall)

    if (twoStory || h2 > 0.58) {
      // flat concrete roof (the modern Kaduna look), water tank for some
      box('roof', w + 0.5, 0.32, d + 0.5, x, hh + 0.16, z, rot, ROOFS_FLAT[Math.floor(h3 * ROOFS_FLAT.length)])
      if (h3 > 0.68) cyl('dark', 0.55, 0.55, 0.9, 8, x + w * 0.22, hh + 0.75, z - d * 0.18)
    } else {
      cone('roof', Math.max(w, d) * 0.74, 1.9, 4, x, hh + 0.95, z, rot + Math.PI / 4, ROOFS_PITCH[ri % ROOFS_PITCH.length])
    }

    // door faces the nearest road
    const [dnx, dnz] = doorSide(x, z)
    if (dnx !== 0) {
      box('door', 0.22, 2.3, 1.1, x + dnx * (w / 2 + 0.1), 1.15, z, rot)
    } else {
      box('door', 1.1, 2.3, 0.22, x, 1.15, z + dnz * (d / 2 + 0.1), rot)
    }
    // windows on both flanks
    const winY = twoStory ? 4.6 : 1.9
    box('window', 0.16, 1.1, 1.0, x - w / 2 - 0.08, winY, z + d / 6, rot)
    box('window', 0.16, 1.1, 1.0, x + w / 2 + 0.08, winY, z - d / 6, rot)
    if (twoStory && dnx === 0) {
      box('window', 1.0, 1.1, 0.16, x + w / 5, winY, z + dnz * (d / 2 + 0.08), rot)
    }
    // front slab for every third house
    if (h3 < 0.34) {
      box('concrete', dnx !== 0 ? 1.4 : 2.6, 0.14, dnx !== 0 ? 2.6 : 1.4, x + dnx * (w / 2 + 0.8), 0.07, z + dnz * (d / 2 + 0.8), rot)
    }
  }

  function doorSide(x: number, z: number): [number, number] {
    const d = hashDist(roadHash(), x, z, 60)
    if (d > 58) return [0, 1]
    // probe the four cardinal directions: first with closer road coverage wins
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

  // ---------------------------------------------------------------- trees
  const rng = mulberry32(0x7ee5)
  function tree(x: number, z: number, s: number, species: number) {
    if (species === 0) {
      // neem: dense round canopy
      cyl('trunk', 0.18 * s, 0.32 * s, 3.4 * s, 6, x, 1.7 * s, z)
      sphere('leaf', 2.3 * s, x, 4.5 * s, z)
      sphere('leaf2', 1.6 * s, x + 0.9 * s, 5.4 * s, z - 0.5 * s)
    } else if (species === 1) {
      // mango: wide low crown
      cyl('trunk', 0.2 * s, 0.34 * s, 2.8 * s, 6, x, 1.4 * s, z)
      const g = new THREE.SphereGeometry(2.7 * s, 12, 9)
      g.scale(1.15, 0.72, 1.15)
      g.translate(x, 3.9 * s, z)
      push('leaf2', g)
    } else if (species === 2) {
      // palm: tall curved stem + drooping fronds
      let px = x
      const top = 6.4 * s
      for (let i = 0; i < 3; i++) {
        cyl('trunk', 0.16 * s - i * 0.02, 0.22 * s - i * 0.02, 2.2 * s, 6, px, (0.6 + i * 2.1) * s, z)
        px += 0.16 * s
      }
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + rng()
        const fr = new THREE.BoxGeometry(2.4 * s, 0.07 * s, 0.5 * s)
        fr.translate(1.2 * s, 0, 0)
        fr.rotateZ(-0.5 - rng() * 0.25)
        fr.rotateY(a)
        fr.translate(px + 0.1 * s, top, z)
        push('leaf', fr)
      }
      sphere('trunk', 0.22 * s, px, top - 0.3 * s, z + 0.2 * s)
    } else {
      // baobab: fat bottle trunk, sparse crown
      cyl('trunk', 1.0 * s, 1.5 * s, 3.6 * s, 7, x, 1.8 * s, z)
      cyl('trunk', 0.22 * s, 0.3 * s, 1.6 * s, 5, x + 0.8 * s, 4.2 * s, z)
      cyl('trunk', 0.22 * s, 0.3 * s, 1.6 * s, 5, x - 0.7 * s, 4.3 * s, z + 0.4 * s)
      sphere('leaf2', 1.4 * s, x + 1.0 * s, 5.2 * s, z)
      sphere('leaf', 1.2 * s, x - 0.9 * s, 5.3 * s, z + 0.4 * s)
    }
  }

  for (const [x, z, s] of BAKE.trees) {
    const sp = Math.floor(hash01(x, z) * 4)
    tree(x, z, 1.1 + s * 0.85, sp === 3 && hash01(x, z, 3) < 0.5 ? 2 : sp)
  }
  // riverbank planting
  {
    const pts = river.main
    for (let i = 6; i < pts.length - 6; i += 7) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz) || 1
      for (const side of [1, -1]) {
        if (rng() < 0.42) continue
        const off = river.width / 2 + 2.2 + rng() * 4
        const x = ax + (-dz / len) * off * side
        const z = az + (dx / len) * off * side
        if (hashDist(houseHash(), x, z) < 4.5) continue
        tree(x, z, 1.0 + rng() * 0.9, rng() < 0.45 ? 2 : Math.floor(rng() * 4))
      }
    }
  }
  // roadside planting on primary routes outside the dense center
  for (const r of BAKE.roads) {
    if (r.class !== 'primary' && r.class !== 'trunk') continue
    const rw = roadWidth(r.class)
    for (let i = 0; i < r.pts.length - 1; i += 2) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const segLen = Math.hypot(bx - ax, bz - az)
      const n = Math.floor(segLen / 30)
      for (let k = 0; k < n; k++) {
        if (rng() < 0.5) continue
        const t = (k + 0.5) / n
        const fx = (bx - ax) / (segLen || 1)
        const fz = (bz - az) / (segLen || 1)
        for (const side of [1, -1]) {
          if (rng() < 0.5) continue
          const off = rw / 2 + 1.8 + rng() * 2
          const x = ax + (bx - ax) * t + -fz * off * side
          const z = az + (bz - az) * t + fx * off * side
          if (hashDist(houseHash(), x, z) < 4) continue
          if (hashDist(roadHash(), x, z) < 2.2) continue
          tree(x, z, 1.0 + rng() * 0.8, rng() < 0.5 ? 0 : 1)
        }
      }
    }
  }
  // park + golf clusters
  for (const lm of BAKE.landmarks) {
    if (lm.kind !== 'golf' && lm.kind !== 'park' && lm.kind !== 'square') continue
    const n = lm.kind === 'golf' ? 26 : 14
    for (let i = 0; i < n; i++) {
      const x = lm.x + (rng() - 0.5) * (lm.kw + 40)
      const z = lm.z + (rng() - 0.5) * (lm.kd + 40)
      if (hashDist(houseHash(), x, z) < 4) continue
      tree(x, z, 1.1 + rng() * 1.0, Math.floor(rng() * 4))
    }
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
          tree(x + tx, z + tz, 1.4, 0)
        }
        // flower garden ring
        garden(x - 16, z + 14)
        break
      }
      case 'market': {
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 6; c++) {
            const sx = x - 21 + c * 8.4
            const sz = z - 12 + r * 8
            box('wall', 6.4, 2.6, 5.2, sx, 1.3, sz, 0, '#5d6e46')
            box('roof', 7.2, 0.3, 6.2, sx, 2.85, sz, 0, r % 2 ? '#b8433a' : '#e8b84b')
            // vendor table + goods
            box('trunk', 4.2, 0.75, 2.2, sx, 0.38, sz + 3.6)
            box('crop2', 1.1, 0.5, 1.0, sx - 1.2, 1.0, sz + 3.5)
            box('white', 0.9, 0.6, 0.9, sx + 0.2, 1.05, sz + 3.7, 0, UMBRELLAS[(r + c) % 4])
            box('crop1', 1.2, 0.4, 1.1, sx + 1.3, 0.95, sz + 3.6)
          }
        }
        box('stone', 46, 0.1, 34, x, 0.06, z, 0, '#a89f85')
        // perimeter stalls with umbrellas
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2
          const sx = x + Math.cos(a) * 30
          const sz = z + Math.sin(a) * 24
          box('trunk', 3.4, 0.75, 2.0, sx, 0.38, sz)
          cyl('trunk', 0.05, 0.05, 2.6, 5, sx, 1.3, sz)
          cone('white', 1.7, 0.8, 8, sx, 2.8, sz, 0, UMBRELLAS[i % 4])
        }
        break
      }
      case 'stadium': {
        const g1 = new THREE.CylinderGeometry(20, 22, 4.5, 30, 1, true)
        g1.translate(x, 2.25, z)
        push('stone', g1, '#b7b4ab')
        const g2 = new THREE.CylinderGeometry(15.5, 15.5, 0.2, 24)
        g2.translate(x, 0.35, z)
        push('green2', g2, '#4f8f45')
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
          cyl('green2', 6 + rand() * 8, 6 + rand() * 8, 0.08, 14, gx, 0.05, gz, '#5d9a4c')
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
        garden(x - 18, z + 6)
        garden(x + 18, z + 6)
        break
      }
      case 'museum': {
        box('white', 12, 4.2, 8, x, 2.1, z)
        cyl('white', 4.5, 4.5, 3.4, 14, x + 9, 1.7, z + 2)
        dome('stone', 4.7, x + 9, 3.4, z + 2, '#b7b4ab')
        garden(x - 10, z + 8)
        break
      }
      case 'hotel': {
        box('white', 9, 15, 9, x, 7.5, z, 0, '#e8ddc8')
        box('metal', 9.6, 0.6, 9.6, x, 15.4, z)
        box('water', 7, 0.15, 4.5, x + 9, 0.1, z + 7)
        box('sand', 9, 0.1, 6.5, x + 9, 0.05, z + 7, 0, '#d8cba0')
        // pool deck + umbrellas
        for (let i = 0; i < 3; i++) {
          cyl('trunk', 0.05, 0.05, 2.4, 5, x + 6 + i * 3, 1.2, z + 11)
          cone('white', 1.4, 0.7, 8, x + 6 + i * 3, 2.6, z + 11, 0, UMBRELLAS[i])
        }
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
        box('green2', 30, 0.08, 18, x, 0.05, z, 0, '#5d9a4c')
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
        box('green2', 40, 0.08, 26, x - 24, 0.05, z + 4, 0, '#5d9a4c')
        footballPitch(x - 24, z + 4)
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
          tree(hx + 9, hz + 6, 1.2, i % 2 ? 0 : 1)
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
    if (lm.lh > 0 && kind !== 'label') label(lm.name, x, lm.lh, z, Math.min(34, 12 + lm.name.length * 0.85))
  }

  function garden(gx: number, gz: number) {
    cyl('green2', 3.4, 3.8, 0.14, 12, gx, 0.07, gz, '#4f7d3f')
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      sphere(['flower1', 'flower2', 'flower3'][i % 3], 0.3, gx + Math.cos(a) * 2.6, 0.4, gz + Math.sin(a) * 2.6)
    }
    sphere('flower1', 0.4, gx, 0.45, gz)
  }

  function footballPitch(px: number, pz: number) {
    box('green2', 34, 0.06, 20, px, 0.09, pz, 0, '#4f8f45')
    // touchlines + halfway
    box('line', 34, 0.02, 0.18, px, 0.13, pz - 10)
    box('line', 34, 0.02, 0.18, px, 0.13, pz + 10)
    box('line', 0.18, 0.02, 20, px - 17, 0.13, pz)
    box('line', 0.18, 0.02, 20, px + 17, 0.13, pz)
    box('line', 0.14, 0.02, 20, px, 0.13, pz)
    // both goals
    for (const s of [-1, 1]) {
      box('white', 0.12, 2.2, 0.12, px + s * 17, 1.1, pz - 2.2)
      box('white', 0.12, 2.2, 0.12, px + s * 17, 1.1, pz + 2.2)
      box('white', 0.12, 0.12, 4.5, px + s * 17, 2.2, pz)
    }
  }

  // ---------------------------------------------------------------- towers
  for (const t of TOWERS) {
    const shaft = new THREE.BoxGeometry(t.w, t.h, t.d)
    shaft.translate(t.x, t.h / 2, t.z)
    push(t.glass ? 'glass' : 'concrete', shaft, t.glass ? '#8fb6c4' : '#c8c4b8')
    for (let fy = 3.4; fy < t.h - 1; fy += 3.6) {
      box('concrete', t.w + 0.3, 0.3, t.d + 0.3, t.x, fy, t.z)
    }
    box('concrete', t.w + 2.2, 2.8, t.d + 2.2, t.x, 1.4, t.z)
    box('dark', t.w + 1.2, 0.5, t.d + 1.2, t.x, 3.1, t.z)
    box('concrete', t.w + 0.8, 0.6, t.d + 0.8, t.x, t.h + 0.3, t.z)
    cyl('metal', 0.09, 0.13, 3.4, 5, t.x, t.h + 2.2, t.z)
    sphere('rust', 0.28, t.x, t.h + 4, t.z, '#e84a3a')
  }

  // ---------------------------------------------------------------- farms
  for (const f of FARMS) {
    const soil = new THREE.BoxGeometry(9.5, 0.16, 7.5)
    soil.rotateY(-f.ang)
    soil.translate(f.x, 0.08, f.z)
    push('soil', soil)
    const rows = f.kind === 0 ? 4 : 5
    const rowH = f.kind === 0 ? 1.2 : f.kind === 1 ? 0.5 : 0.8
    const rowD = f.kind === 2 ? 1.0 : 0.55
    for (let r = 0; r < rows; r++) {
      const off = (r - (rows - 1) / 2) * 1.55
      const rowG = new THREE.BoxGeometry(8.2, rowH, rowD)
      rowG.rotateY(-f.ang)
      // perpendicular offset: perp of (cos a, sin a) is (-sin a, cos a)
      rowG.translate(f.x - Math.sin(f.ang) * off, rowH / 2 + 0.08, f.z + Math.cos(f.ang) * off)
      push(f.kind === 0 ? 'crop1' : f.kind === 1 ? 'crop2' : 'crop3', rowG)
    }
    if (hash01(f.x, f.z, 31) < 0.12) {
      tree(f.x + 5.4, f.z + 4.2, 1.1, 2)
    }
  }

  // ---------------------------------------------------------------- dam
  {
    const { x, z, ang } = DAM
    const px = -Math.sin(ang) // perpendicular to the river flow
    const pz = Math.cos(ang)
    const rx = Math.cos(ang) // along the river flow
    const rz = Math.sin(ang)
    const wallW = BAKE.river.width + 14
    const wall = new THREE.BoxGeometry(wallW, 7, 3.2)
    wall.rotateY(-(ang + Math.PI / 2))
    wall.translate(x, 3.5, z)
    push('concrete', wall, '#b8b4a8')
    const crest = new THREE.BoxGeometry(wallW + 1.4, 0.5, 4.4)
    crest.rotateY(-(ang + Math.PI / 2))
    crest.translate(x, 7.2, z)
    push('stone', crest, '#a8a49a')
    // spill gates on the downstream face + white water chute
    for (let i = -2; i <= 2; i++) {
      cyl('metal', 0.8, 0.8, 3.4, 8, x + px * i * 5 + rx * 1.9, 3.4, z + pz * i * 5 + rz * 1.9)
    }
    const chute = new THREE.BoxGeometry(6, 0.5, 9)
    chute.rotateY(-ang)
    chute.translate(x + rx * 5.5, 4.4, z + rz * 5.5)
    push('white', chute, '#dfeef2')
    // powerhouse + transmission pylons on the bank
    box('white', 9, 4.6, 6, x + px * 12, 2.3, z + pz * 12, -ang)
    for (let i = 0; i < 2; i++) {
      const pxx = x + px * (20 + i * 26)
      const pzz = z + pz * (20 + i * 26)
      cyl('metal', 0.16, 0.22, 13, 6, pxx, 6.5, pzz)
      box('metal', 3.4, 0.16, 0.16, pxx, 11.6, pzz, -ang)
      box('metal', 2.4, 0.16, 0.16, pxx, 9.8, pzz, -ang)
    }
    label('River Kaduna Dam', x, 14, z, 22, '#ffe9a8')
  }

  // ---------------------------------------------------------------- Romi stream label
  label('Romi Stream', ROMI.pts[3][0], 8, ROMI.pts[3][1], 14, '#bfe3ef')

  // ---------------------------------------------------------------- construction sites
  for (const s of SITES) {
    const { x, z, rot } = s
    box('stone', 15, 0.12, 11, x, 0.06, z, rot, '#a89f85')
    // concrete skeleton: 6 columns + 2 slabs
    for (const [cx, cz] of [[-4.5, -3], [0, -3], [4.5, -3], [-4.5, 3], [0, 3], [4.5, 3]] as const) {
      const wx = x + cx * Math.cos(rot) - cz * Math.sin(rot)
      const wz = z + cx * Math.sin(rot) + cz * Math.cos(rot)
      box('concrete', 0.7, 7.2, 0.7, wx, 3.6, wz, rot)
    }
    box('concrete', 11.4, 0.35, 8.4, x, 3.75, z, rot)
    box('concrete', 11.4, 0.35, 8.4, x, 7.3, z, rot)
    // starter block walls
    box('wall', 8, 1.4, 0.3, x, 0.9, z + 4.2 * Math.cos(rot), rot, '#9aa39a')
    box('wall', 0.3, 1.4, 6, x + 5.4 * Math.cos(rot), 0.9, z + 5.4 * Math.sin(rot), rot, '#9aa39a')
    // scaffolding along the front
    for (let i = 0; i < 4; i++) {
      const px2 = x - 6 + i * 4
      cyl('metal', 0.09, 0.09, 8.4, 5, px2, 4.2, z + 5.6)
      if (i < 3) box('trunk', 4.0, 0.12, 0.9, x - 4 + i * 4, 2.6 + (i % 2) * 2.2, z + 5.6, rot)
    }
    // ladder
    box('trunk', 0.1, 7, 0.1, x + 6.4, 3.5, z + 4.6, rot)
    box('trunk', 0.1, 7, 0.1, x + 6.4, 3.5, z + 5.4, rot)
    for (let r2 = 0; r2 < 5; r2++) box('trunk', 0.08, 0.08, 0.75, x + 6.4, 1 + r2 * 1.4, z + 5, rot)
    // piles + cement + mixer
    cone('sand', 2.3, 1.6, 8, x - 9, 0.85, z - 6)
    cone('stone', 1.8, 1.2, 8, x - 4.5, 0.65, z - 7)
    for (let b = 0; b < 6; b++) {
      box('white', 1.0, 0.38, 0.6, x + 8.4 + (b % 2) * 0.15, 0.25 + Math.floor(b / 2) * 0.4, z - 6.5 + (b % 3) * 0.7, rot)
    }
    const drum = new THREE.CylinderGeometry(0.85, 1.1, 2.1, 9)
    drum.rotateZ(1.25)
    drum.rotateY(rot)
    drum.translate(x + 9.5, 1.15, z - 3.4)
    push('metal', drum, '#b8bcc4')
    label('Construction Site', x, 11.5, z, 17, '#e8b84b')
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

  // ---------------------------------------------------------------- merge into tiles
  const TILE = 512
  const meshes: TileMesh[] = []
  const castBuckets = new Set(['wall', 'roof', 'stone', 'white', 'metal', 'dark', 'green', 'green2', 'glass', 'concrete', 'trunk', 'leaf', 'leaf2'])
  const tiles = new Map<string, Buckets>()
  for (const [bucket, geos] of Object.entries(buckets)) {
    for (const g of geos) {
      g.computeBoundingBox()
      const bb = g.boundingBox!
      const cx = (bb.min.x + bb.max.x) / 2
      const cz = (bb.min.z + bb.max.z) / 2
      const key = `${Math.floor(cx / TILE)},${Math.floor(cz / TILE)}`
      let t = tiles.get(key)
      if (!t) tiles.set(key, (t = {}))
      ;(t[bucket] ??= []).push(g)
    }
  }
  for (const [, tb] of tiles) {
    for (const [bucket, geos] of Object.entries(tb)) {
      if (!geos.length) continue
      const merged = mergeGeometries(geos, false)
      if (merged) {
        merged.computeBoundingBox()
        const bb = merged.boundingBox!
        meshes.push({
          geometry: merged,
          color: bucketColor[bucket] ?? '#cccccc',
          cast: castBuckets.has(bucket),
          cx: (bb.min.x + bb.max.x) / 2,
          cz: (bb.min.z + bb.max.z) / 2
        })
      }
      for (const g of geos) g.dispose()
    }
  }

  // water texture: soft moving streaks
  const wc = document.createElement('canvas')
  wc.width = wc.height = 256
  const wctx = wc.getContext('2d')!
  wctx.fillStyle = '#3f6f85'
  wctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 70; i++) {
    wctx.fillStyle = `rgba(255,255,255,${0.04 + rand() * 0.09})`
    const wx = rand() * 256
    const wy = rand() * 256
    const wlen = 24 + rand() * 60
    wctx.beginPath()
    wctx.ellipse(wx, wy, wlen, 2 + rand() * 3, 0, 0, Math.PI * 2)
    wctx.fill()
  }
  for (let i = 0; i < 24; i++) {
    wctx.fillStyle = 'rgba(30,70,90,0.12)'
    wctx.beginPath()
    wctx.ellipse(rand() * 256, rand() * 256, 20 + rand() * 40, 14 + rand() * 20, 0, 0, Math.PI * 2)
    wctx.fill()
  }
  const waterTexture = new THREE.CanvasTexture(wc)
  waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping
  const waterMaterial = new THREE.MeshBasicMaterial({
    map: waterTexture,
    transparent: true,
    opacity: 0.92
  })

  return { meshes, sprites, water: waterGeos, waterTexture, waterMaterial }
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

// tile distance culling: skip geometry far outside the fog range
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const meshRefs = ref<THREE.Mesh[]>([])
let cullTimer = 0
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  cullTimer += delta || 0
  if (cullTimer > 0.2 && cityRef.value) {
    cullTimer = 0
    const px = playerPos.value[0]
    const pz = playerPos.value[2]
    for (const m of meshRefs.value) {
      const g = m.geometry as THREE.BufferGeometry
      const bb = g.boundingBox
      if (!bb) continue
      const cx = (bb.min.x + bb.max.x) / 2
      const cz = (bb.min.z + bb.max.z) / 2
      const dx = cx - px
      const dz = cz - pz
      m.visible = dx * dx + dz * dz < 1650 * 1650
    }
  }
  // drift the water
  const wm = cityRef.value?.waterMaterial
  if (wm?.map) {
    wm.map.offset.x = (elapsed * 0.016) % 1
    wm.map.offset.y = (elapsed * 0.006) % 1
  }
})
</script>

<template>
  <TresGroup v-if="cityRef">
    <TresMesh
      v-for="(m, i) in cityRef.meshes"
      :key="'km' + i"
      :ref="(el) => { if (el) meshRefs[i] = el as any }"
      :geometry="m.geometry"
      cast-shadow
      receive-shadow
    >
      <TresMeshLambertMaterial :color="m.color" :vertex-colors="true" />
    </TresMesh>
    <TresMesh v-for="(w, i) in cityRef.water" :key="'kw' + i" :geometry="w" :material="cityRef.waterMaterial" />
    <TresSprite v-for="(s, i) in cityRef.sprites" :key="'ks' + i" :position="[s.x, s.y, s.z]" :scale="[s.w, s.h, 1]">
      <TresSpriteMaterial :map="s.texture" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
