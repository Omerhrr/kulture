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
import { BAKE, BRIDGE_NAMES, WORLD_SCALE, roadW, ws, SIDEWALK_W, PLAYABLE_POS } from '~/utils/kaduna'
// keep storefronts / NPC spots / spawn readable: no trees or kiosks in front
const KEEP_CLEAR = Object.values(PLAYABLE_POS)
const inKeepClear = (x: number, z: number, r = 14) => KEEP_CLEAR.some(([px, pz]) => Math.abs(x - px) < r && Math.abs(z - pz) < r)
import { buildHouseSystem, makeHouseMaterial, type HouseSystem } from '~/utils/housing'
import { buildTowerMeshes } from '~/utils/towers'
import { addWindSway } from '~/utils/weather'
import { getQuality } from '~/utils/quality'
import { buildCivic } from '~/utils/civic'
import { addColliders, type Box } from '~/utils/collision'
import { crosswalks, roadMedians } from '~/utils/kadunaLighting'
import {
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
  curb: '#c8c2b2',
  median: '#c2bca9',
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

// Nigerian wall palette (no red walls - that was the v2 complaint) and
// roof palettes dominated by zinc silver, stone coated brown/green and
// slate like the real city. Red is a deliberate rarity now, not a default.
// weighted pitch roof pick: zinc gray and silver first, then bronze,
// stone green, brown, slate; brick red under 8 percent
const ROOFS_PITCH = ['#6b7280', '#9aa0a6', '#8a6a4a', '#5d6e46', '#7d5a4a', '#4a5a6a', '#3f5a48', '#8a4a3a']
const UMBRELLAS = ['#c94a3a', '#e8b84b', '#3f7d5b', '#3f6fae']

function pickRoofPitch(h: number): string {
  // cumulative weights: zinc 0.3, silver 0.2, bronze 0.14, green 0.12,
  // brown 0.1, slate 0.08, deep green 0.04, red 0.02
  if (h < 0.3) return ROOFS_PITCH[0]
  if (h < 0.5) return ROOFS_PITCH[1]
  if (h < 0.64) return ROOFS_PITCH[2]
  if (h < 0.76) return ROOFS_PITCH[3]
  if (h < 0.86) return ROOFS_PITCH[4]
  if (h < 0.94) return ROOFS_PITCH[5]
  if (h < 0.98) return ROOFS_PITCH[6]
  return ROOFS_PITCH[7]
}

type Buckets = Record<string, THREE.BufferGeometry[]>

interface TileMesh {
  geometry: THREE.BufferGeometry
  bucket: string
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
  houses: HouseSystem
  mats: Record<string, THREE.Material>
  civic: THREE.Mesh | null
  houseMaterial: THREE.Material
  towers: ReturnType<typeof buildTowerMeshes>
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
  /** flat painted marking (2 triangles, faces up) */
  const flat = (b: string, w: number, d: number, x: number, y: number, z: number, ry = 0) => {
    const g = new THREE.PlaneGeometry(w, d)
    g.rotateX(-Math.PI / 2)
    if (ry) g.rotateY(ry)
    g.translate(x, y, z)
    push(b, g)
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
    const g = new THREE.SphereGeometry(r, 9, 7)
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
      // counter-clockwise seen from above so the faces point up (the old
      // winding faced down and back-face culling hid every road)
      const quad = [
        [ax + nx, az + nz],
        [bx - nx, bz - nz],
        [ax - nx, az - nz],
        [ax + nx, az + nz],
        [bx + nx, bz + nz],
        [bx - nx, bz - nz]
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

  const rng = mulberry32(0x7ee5)
  // solid street furniture + tree trunks (handed to the collision grid)
  const solids: Box[] = []

  // ---------------------------------------------------------------- ground
  // subdivided savanna: base greens, dry patches, lush band near water
  {
    const g = new THREE.PlaneGeometry(3600 * WORLD_SCALE, 3200 * WORLD_SCALE, 150, 130)
    g.rotateX(-Math.PI / 2)
    g.translate(ws(-350), -0.12, ws(200))
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
      const n = hash01(x * 0.037, z * 0.037) * 0.6 + hash01(x * 0.01, z * 0.01, 3) * 0.4
      c.copy(base1).lerp(base2, n)
      const dryN = hash01(x * 0.007, z * 0.007, 7)
      if (dryN > 0.72) c.lerp(dry, Math.min(1, (dryN - 0.72) * 3))
      const wd = hashDist(waterHash(), x, z, 200)
      if (wd < 120) c.lerp(lush, 1 - wd / 120)
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
  ribbon('water_bank', river.main, river.width + 22, undefined, 0.02)
  for (const s of river.side) {
    ribbon('water_bank', s, river.width * 0.7 + 16, undefined, 0.02)
    ribbon('water', s, river.width * 0.7, undefined, 0.06)
  }
  // animated water: main stem + reservoir + Romi stream
  waterGeos.push(ribbonGeo(river.main, river.width, 0.06))
  waterGeos.push(ribbonGeo(river.main.slice(0, DAM.idx + 1), river.width * 2.1, 0.12))
  waterGeos.push(ribbonGeo(ROMI.pts, 12, 0.06))
  ribbon('water_bank', ROMI.pts, 24, undefined, 0.02)

  function ribbonGeo(pts: [number, number][], width: number, y: number): THREE.BufferGeometry {
    const pos: number[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az) || 1
      const nx = (-(bz - az) / len) * (width / 2)
      const nz = ((bx - ax) / len) * (width / 2)
      // counter-clockwise seen from above so the faces point up (the old
      // winding faced down and back-face culling hid every road)
      const quad = [
        [ax + nx, az + nz],
        [bx - nx, bz - nz],
        [ax - nx, az - nz],
        [ax + nx, az + nz],
        [bx + nx, bz + nz],
        [bx - nx, bz - nz]
      ]
      for (const [x, z] of quad) pos.push(x, y, z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    return g
  }

  // ---------------------------------------------------------------- roads
  // real street section: compacted shoulder + concrete sidewalks with a
  // curb line on both sides, asphalt on top, lane paint on main roads and
  // zebra crossings at the busy spots
  // real-size streets: 13 m trunk roads, 9.5 m primaries, 6.5 m side
  // streets, each with a 2.6 m sidewalk + curb on both sides
  for (const r of BAKE.roads) {
    const rw = roadW(r)
    // sidewalk slab under the whole street section (white vertex colors so
    // the bucket material color lands exactly, not squared)
    ribbon('concrete', r.pts, rw + SIDEWALK_W * 2, '#ffffff', 0.04)
    ribbon('curb', r.pts, rw + 0.6, '#ffffff', 0.08)
    ribbon('asphalt', r.pts, rw, '#ffffff', 0.12)
    if (r.class === 'trunk' || r.class === 'primary' || r.class === 'secondary') {
      // painted lane lines: yellow centre on two-way roads, white dashes
      // between lanes, solid white edge lines on the main roads
      const main = r.class !== 'secondary'
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i]
        const [bx, bz] = r.pts[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 0.5) continue
        const fx = (bx - ax) / len
        const fz = (bz - az) / len
        const n = Math.max(1, Math.floor(len / 9))
        const a = Math.atan2(bz - az, bx - ax)
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n
          const x = ax + (bx - ax) * t
          const z = az + (bz - az) * t
          if (!r.twin) flat('gold', 3.2, 0.16, x, 0.16, z, -a)
          if (main) {
            const lane = r.twin ? 0 : rw / 4
            for (const sd of r.twin ? [0] : [-1, 1]) {
              flat('line', 3.0, 0.14, x - fz * lane * sd, 0.16, z + fx * lane * sd, -a)
            }
          }
        }
        if (main) {
          for (const sd of [-1, 1]) {
            const o = rw / 2 - 0.35
            const g = new THREE.PlaneGeometry(len, 0.14)
            g.rotateX(-Math.PI / 2)
            g.rotateY(-a)
            g.translate((ax + bx) / 2 - fz * o * sd, 0.16, (az + bz) / 2 + fx * o * sd)
            push('line', g)
          }
        }
      }
    }
  }

  // zebra crossings (shared with the pedestrian AI so people cross here)
  for (const cw of crosswalks()) {
    const stripes = Math.ceil((cw.rw + 2.6) / 1.15)
    for (let k = 0; k < stripes; k++) {
      const off = (k - (stripes - 1) / 2) * 1.15
      const sx = cw.x + cw.nx * off
      const sz = cw.z + cw.nz * off
      box('white', 2.3, 0.025, 0.55, sx, 0.165, sz, Math.atan2(cw.fx, cw.fz))
    }
    // stop line on the approach side
    box('white', 0.35, 0.025, cw.rw + 2.2, cw.x + cw.fx * 2.6, 0.165, cw.z + cw.fz * 2.6, Math.atan2(cw.nx, cw.nz))
  }

  // boulevard medians between twin carriageways (raised concrete island)
  for (const md of roadMedians()) {
    ribbon('median', md.pts, 2.0, '#ffffff', 0.22)
    // palms along the island
    for (let i = 2; i < md.pts.length - 2; i += 6) {
      const [mx, mz] = md.pts[i]
      tree(mx, mz, 0.9, 2)
    }
  }

  // streetlights along the main roads
  // modern 8 m LED street lights (matches kadunaLighting.streetlights)
  for (const r of BAKE.roads) {
    if (r.class !== 'primary' && r.class !== 'trunk') continue
    const rw = roadW(r)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const segLen = Math.hypot(bx - ax, bz - az)
      const n = Math.floor(segLen / 34)
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        const fx = (bx - ax) / (segLen || 1)
        const fz = (bz - az) / (segLen || 1)
        const ox = -fz * (rw / 2 + SIDEWALK_W * 0.6)
        const oz = fx * (rw / 2 + SIDEWALK_W * 0.6)
        cyl('metal', 0.09, 0.14, 8, 6, x + ox, 4, z + oz)
        solids.push({ x: x + ox, z: z + oz, w: 0.3, d: 0.3 })
        const a = Math.atan2(-ox, -oz)
        const armG = new THREE.BoxGeometry(0.1, 0.1, 2.4)
        armG.rotateY(a)
        armG.translate(x + ox - Math.sin(a) * 1.1, 7.9, z + oz - Math.cos(a) * 1.1)
        push('metal', armG)
        const headG = new THREE.BoxGeometry(0.7, 0.14, 0.34)
        headG.rotateY(a)
        headG.translate(x + ox - Math.sin(a) * 2.2, 7.85, z + oz - Math.cos(a) * 2.2)
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
    ribbon('stone', ap.runway, 45, undefined, 0.04)
    for (let i = 0; i < ap.runway.length - 1; i++) {
      const [ax, az] = ap.runway[i]
      const [bx, bz] = ap.runway[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.floor(len / 30))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        box('white', 0.9, 0.02, 12, ax + (bx - ax) * t, 0.09, az + (bz - az) * t, Math.atan2(bz - az, bx - ax))
      }
    }
    const rx = ap.runway[0][0]
    const rz = ap.runway[0][1]
    // modern terminal: glass front, cantilevered roof, control tower
    box('white', 90, 12, 34, rx - 30, 6, rz + 70)
    box('glass', 90.4, 9, 0.4, rx - 30, 5.5, rz + 52.9, 0, '#7fa6b6')
    box('metal', 96, 1.2, 42, rx - 30, 12.6, rz + 68)
    cyl('white', 3.2, 4.2, 34, 12, rx + 30, 17, rz + 70)
    cyl('glass', 6, 6, 4.5, 12, rx + 30, 36, rz + 70, '#7fa6b6')
    cyl('dark', 6.6, 6.6, 1, 12, rx + 30, 38.8, rz + 70)
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

  // houses are instanced prefabs now (utils/housing.ts)

  // ---------------------------------------------------------------- trees
  function tree(x: number, z: number, s: number, species: number) {
    if (inKeepClear(x, z)) return
    solids.push({ x, z, w: (species === 3 ? 2.2 : 0.55) * s, d: (species === 3 ? 2.2 : 0.55) * s })
    if (species === 0) {
      // neem: dense round canopy
      cyl('trunk', 0.18 * s, 0.32 * s, 3.4 * s, 6, x, 1.7 * s, z)
      sphere('leaf', 2.3 * s, x, 4.5 * s, z)
      sphere('leaf2', 1.6 * s, x + 0.9 * s, 5.4 * s, z - 0.5 * s)
    } else if (species === 1) {
      // mango: wide low crown
      cyl('trunk', 0.2 * s, 0.34 * s, 2.8 * s, 6, x, 1.4 * s, z)
      const g = new THREE.SphereGeometry(2.7 * s, 9, 7)
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
    for (let i = 6; i < pts.length - 6; i += 3) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz) || 1
      for (const side of [1, -1]) {
        if (rng() < 0.42) continue
        const off = river.width / 2 + 5 + rng() * 9
        const x = ax + (-dz / len) * off * side
        const z = az + (dx / len) * off * side
        if (hashDist(houseHash(), x, z) < 10) continue
        tree(x, z, 1.0 + rng() * 0.9, rng() < 0.45 ? 2 : Math.floor(rng() * 4))
      }
    }
  }
  // roadside planting on primary routes outside the dense center
  for (const r of BAKE.roads) {
    const rw = roadW(r)
    const mainRoad = r.class === 'primary' || r.class === 'trunk'
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const segLen = Math.hypot(bx - ax, bz - az)
      const n = Math.floor(segLen / (mainRoad ? 24 : 34))
      for (let k = 0; k < n; k++) {
        if (rng() < (mainRoad ? 0.35 : 0.7)) continue
        const t = (k + 0.5) / n
        const fx = (bx - ax) / (segLen || 1)
        const fz = (bz - az) / (segLen || 1)
        for (const side of [1, -1]) {
          if (rng() < 0.5) continue
          const off = rw / 2 + SIDEWALK_W - 0.25
          const x = ax + (bx - ax) * t + -fz * off * side
          const z = az + (bz - az) * t + fx * off * side
          if (hashDist(houseHash(), x, z) < 9) continue
          tree(x, z, 1.0 + rng() * 0.8, mainRoad && rng() < 0.35 ? 2 : rng() < 0.5 ? 0 : 1)
        }
      }
    }
  }
  // ---------------------------------------------------------------- street life
  // the things that make a Nigerian street: container kiosks with plastic
  // chairs and umbrellas, generators, bus shelters, billboards, wheelbarrow
  // water vendors, bins. Placed in the gaps between compounds.
  {
    const KIOSK = ['#2f6fae', '#d8262e', '#2f7d5b', '#e8b84b', '#f2f2ee']
    const at = (x: number, z: number, a: number, lx: number, lz: number): [number, number] => [x + lx * Math.cos(a) + lz * Math.sin(a), z - lx * Math.sin(a) + lz * Math.cos(a)]
    const chair = (x: number, z: number, a: number, col: string) => {
      box('white', 0.45, 0.06, 0.45, x, 0.45, z, a, col)
      const [bx2, bz2] = at(x, z, a, 0, -0.22)
      box('white', 0.45, 0.45, 0.05, bx2, 0.7, bz2, a, col)
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) {
        const [cx, cz] = at(x, z, a, lx, lz)
        box('white', 0.04, 0.45, 0.04, cx, 0.22, cz, a, col)
      }
    }
    const kiosk = (x: number, z: number, a: number, k: number) => {
      const col = KIOSK[k % KIOSK.length]
      solids.push({ x, z, w: 2.6, d: 2.6 })
      box('metal', 2.4, 2.5, 2.4, x, 1.25, z, a, col)
      const [fx, fz] = at(x, z, a, 0, 1.21)
      box('dark', 1.6, 1.0, 0.05, fx, 1.5, fz, a, '#2a2620')
      const [sgx, sgz] = at(x, z, a, 0, 1.24)
      box('white', 2.6, 0.5, 0.06, sgx, 2.8, sgz, a, '#f4f1ea') // signboard
      const [ax2, az2] = at(x, z, a, 0, 1.9)
      box('white', 2.8, 0.08, 1.4, ax2, 2.35, az2, a, col)
      const [tx, tz] = at(x, z, a, 1.6, 2.6)
      cyl('white', 0.4, 0.4, 0.04, 10, tx, 0.72, tz, '#f2f2ee')
      cyl('white', 0.05, 0.05, 0.72, 5, tx, 0.36, tz, '#f2f2ee')
      cyl('trunk', 0.03, 0.03, 2.2, 5, tx, 1.1, tz)
      cone('white', 1.2, 0.5, 8, tx, 2.3, tz, 0, UMBRELLAS[k % UMBRELLAS.length])
      const [c1x, c1z] = at(x, z, a, 1.0, 2.6)
      const [c2x, c2z] = at(x, z, a, 2.2, 2.6)
      chair(c1x, c1z, a + Math.PI / 2, k % 2 ? '#f2f2ee' : '#d8262e')
      chair(c2x, c2z, a - Math.PI / 2, k % 2 ? '#f2f2ee' : '#d8262e')
      // generator humming beside it
      const [gx, gz] = at(x, z, a, -1.7, 0.4)
      box('gold', 0.8, 0.55, 0.55, gx, 0.3, gz, a, '#e0b020')
      box('dark', 0.82, 0.12, 0.57, gx, 0.6, gz, a, '#2a2d33')
    }
    const billboard = (x: number, z: number, a: number, k: number) => {
      const [p1x, p1z] = at(x, z, a, -2.4, 0)
      const [p2x, p2z] = at(x, z, a, 2.4, 0)
      solids.push({ x: p1x, z: p1z, w: 0.4, d: 0.4 }, { x: p2x, z: p2z, w: 0.4, d: 0.4 })
      cyl('metal', 0.14, 0.18, 7, 6, p1x, 3.5, p1z)
      cyl('metal', 0.14, 0.18, 7, 6, p2x, 3.5, p2z)
      box('dark', 7, 3.4, 0.2, x, 7.8, z, a, '#2a2d33')
      box('white', 6.7, 3.1, 0.24, x, 7.8, z, a, ['#e8b84b', '#2f6fae', '#d8262e', '#2f7d5b'][k % 4])
      box('white', 4.2, 0.8, 0.26, x, 8.3, z, a, '#f4f1ea')
    }
    const shelter = (x: number, z: number, a: number) => {
      for (const lx of [-1.8, 1.8]) {
        const [px2, pz2] = at(x, z, a, lx, -0.5)
        cyl('metal', 0.06, 0.06, 2.6, 6, px2, 1.3, pz2)
      }
      box('metal', 4.2, 0.1, 1.8, x, 2.65, z, a, '#3a6a4a')
      const [glx, glz] = at(x, z, a, 0, -0.9)
      box('glass', 3.8, 1.6, 0.05, glx, 1.5, glz, a, '#9fc0cc')
      const [bx3, bz3] = at(x, z, a, 0, -0.5)
      box('trunk', 3.2, 0.08, 0.45, bx3, 0.5, bz3, a)
    }
    const waterCart = (x: number, z: number, a: number) => {
      solids.push({ x, z, w: 1.3, d: 1.3 })
      box('metal', 0.9, 0.35, 1.3, x, 0.55, z, a, '#7a8088')
      for (let j = 0; j < 4; j++) {
        const [jx, jz] = at(x, z, a, (j % 2) * 0.4 - 0.2, Math.floor(j / 2) * 0.5 - 0.25)
        box('white', 0.28, 0.4, 0.2, jx, 0.9, jz, a, j % 2 ? '#e8b84b' : '#2f6fae')
      }
      const [wx, wz] = at(x, z, a, 0, 0.75)
      cyl('dark', 0.2, 0.2, 0.08, 10, wx, 0.2, wz)
    }
    const bin = (x: number, z: number) => {
      solids.push({ x, z, w: 0.7, d: 0.7 })
      cyl('white', 0.32, 0.28, 0.9, 10, x, 0.45, z, '#2f6e3a')
      cyl('dark', 0.34, 0.34, 0.06, 10, x, 0.93, z)
    }
    let k = 0
    for (const r of BAKE.roads) {
      const rw = roadW(r)
      const main = r.class === 'trunk' || r.class === 'primary'
      const step = main ? 60 : r.class === 'secondary' ? 80 : 110
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i]
        const [bx, bz] = r.pts[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 12) continue
        const fx = (bx - ax) / len
        const fz = (bz - az) / len
        for (let t = rng() * step; t < len - 6; t += step * (0.7 + rng() * 0.6)) {
          const side = rng() < 0.5 ? 1 : -1
          const off = rw / 2 + SIDEWALK_W + 1.6
          const x = ax + fx * t - fz * off * side
          const z = az + fz * t + fx * off * side
          if (hashDist(houseHash(), x, z, 30) < 8.5) continue
          if (hashDist(waterHash(), x, z, 60) < 30) continue
          if (inKeepClear(x, z)) continue
          // face the road
          const a = Math.atan2(fz * side, -fx * side)
          const h = rng()
          k++
          if (main && r.class === 'trunk' && h < 0.18) billboard(x - fz * side * 1.5, z + fx * side * 1.5, a, k)
          else if (main && h < 0.32) shelter(x, z, a)
          else if (h < 0.7) kiosk(x, z, a, k)
          else if (h < 0.85) waterCart(x, z, a)
          else bin(x, z)
        }
      }
    }
  }

  // park + golf clusters
  for (const lm of BAKE.landmarks) {
    if (lm.kind !== 'golf' && lm.kind !== 'park' && lm.kind !== 'square') continue
    const n = lm.kind === 'golf' ? 26 : 14
    for (let i = 0; i < n; i++) {
      const x = lm.x + (rng() - 0.5) * (lm.kw + 80)
      const z = lm.z + (rng() - 0.5) * (lm.kd + 80)
      if (hashDist(houseHash(), x, z) < 10) continue
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
        // NOTE: the shed grid + pad are rendered by WorldScene (server
        // entity). Duplicating them here z-fights, so this pass only adds
        // the life: vendor tables, goods, umbrellas and perimeter stalls.
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 6; c++) {
            const sx = x - 21 + c * 8.4
            const sz = z - 12 + r * 8
            box('trunk', 4.2, 0.75, 2.2, sx, 0.38, sz + 3.6)
            box('crop2', 1.1, 0.5, 1.0, sx - 1.2, 1.0, sz + 3.5)
            box('white', 0.9, 0.6, 0.9, sx + 0.2, 1.05, sz + 3.7, 0, UMBRELLAS[(r + c) % 4])
            box('crop1', 1.2, 0.4, 1.1, sx + 1.3, 0.95, sz + 3.6)
          }
        }
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
          cone('roof', 6.4, 2, 4, hx, 4.6, hz, Math.PI / 4, pickRoofPitch(hash01(hx, hz, 91)))
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
    if (lm.lh > 0 && kind !== 'label' && kind !== 'market') label(lm.name, x, lm.lh + 14, z, Math.min(48, 16 + lm.name.length * 1.1))
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

  // towers have their own textured meshes (utils/towers.ts)

  // ---------------------------------------------------------------- farms
  for (const f of FARMS) {
    const soil = new THREE.BoxGeometry(24, 0.16, 19)
    soil.rotateY(-f.ang)
    soil.translate(f.x, 0.08, f.z)
    push('soil', soil)
    const rows = f.kind === 0 ? 10 : 12
    const rowH = f.kind === 0 ? 1.2 : f.kind === 1 ? 0.5 : 0.8
    const rowD = f.kind === 2 ? 1.0 : 0.55
    for (let r = 0; r < rows; r++) {
      const off = (r - (rows - 1) / 2) * 1.55
      const rowG = new THREE.BoxGeometry(22, rowH, rowD)
      rowG.rotateY(-f.ang)
      // perpendicular offset: perp of (cos a, sin a) is (-sin a, cos a)
      rowG.translate(f.x - Math.sin(f.ang) * off, rowH / 2 + 0.08, f.z + Math.cos(f.ang) * off)
      push(f.kind === 0 ? 'crop1' : f.kind === 1 ? 'crop2' : 'crop3', rowG)
    }
    if (hash01(f.x, f.z, 31) < 0.12) {
      tree(f.x + 13, f.z + 10, 1.2, 2)
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
    label('River Kaduna Dam', x, 20, z, 30, '#ffe9a8')
  }

  // ---------------------------------------------------------------- Romi stream label
  label('Romi Stream', ROMI.pts[3][0], 12, ROMI.pts[3][1], 22, '#bfe3ef')

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
    const span = BAKE.river.width + 30
    const deck = Math.max(Math.abs(b.w), 12) + 5
    box('stone', deck, 1.4, span, b.x, 0.85, b.z, b.rot, '#9a948a')
    for (const sd of [-1, 1]) {
      const ox = Math.cos(b.rot) * (deck / 2 - 0.3) * sd
      const oz = -Math.sin(b.rot) * (deck / 2 - 0.3) * sd
      box('metal', 0.35, 1.1, span, b.x + ox, 2.1, b.z + oz, b.rot)
    }
    if (name === 'Coronation Bridge') {
      const arch = new THREE.TorusGeometry(span / 2 - 6, 1.0, 8, 22, Math.PI)
      arch.rotateY(b.rot + Math.PI / 2)
      arch.translate(b.x, 1.2, b.z)
      push('stone', arch, '#9a948a')
    }
    label(name, b.x, 16, b.z, 30, '#ffe9a8')
  }

  // ---------------------------------------------------------------- labels
  for (const p of BAKE.places) {
    label(p.name, p.x, 36, p.z, 40, '#f5f2e8')
  }
  label('River Kaduna', ws(350), 24, ws(-30), 34, '#bfe3ef')
  label('to Zaria 88km', ws(175), 12, ws(-930), 22, '#e8e4d8')
  label('to Jos 230km', ws(300), 12, ws(-1000), 22, '#e8e4d8')
  label('to Abuja 210km', ws(-600), 12, ws(1420), 22, '#e8e4d8')
  label('Kajuru Road - Kajuru Castle 42km', ws(250), 14, ws(1120), 26, '#e8e4d8')

  // ---------------------------------------------------------------- merge into tiles
  const TILE = 768
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
          bucket,
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

  // one material per bucket; foliage (and palm fronds) sway in the wind
  const mats: Record<string, THREE.Material> = {}
  for (const m of meshes) {
    if (mats[m.bucket]) continue
    const mat = new THREE.MeshLambertMaterial({ color: m.color, vertexColors: true })
    if (m.bucket === 'leaf' || m.bucket === 'leaf2') addWindSway(mat as any, 1, 1.6)
    else if (m.bucket === 'trunk') addWindSway(mat as any, 0.35, 2.5)
    else if (m.bucket === 'crop1' || m.bucket === 'crop2' || m.bucket === 'crop3') addWindSway(mat as any, 2.2, 0.1)
    mats[m.bucket] = mat
  }

  addColliders(solids)

  // hospitals, schools, filling stations, mechanics
  const civic = buildCivic()
  if (civic) for (const l of civic.labels) label(l.text, l.x, l.y, l.z, l.w, l.color)

  const houseMaterial = makeHouseMaterial()
  const touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches
  const lowQ = getQuality() === 'low'
  const houses = buildHouseSystem(houseMaterial, touch || lowQ ? 150 : 230, touch || lowQ ? 1300 : 1800)
  const towers = buildTowerMeshes()

  return { meshes, mats, civic: civic?.mesh ?? null, sprites, water: waterGeos, waterTexture, waterMaterial, houses, houseMaterial, towers }
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
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [ws(-98), 0, ws(40)])
const meshRefs = ref<THREE.Mesh[]>([])
let cullTimer = 0
const nightFactor = useState<number>('kk_night', () => 0)
const CULL = 2600
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
      m.visible = dx * dx + dz * dz < CULL * CULL
    }
    cityRef.value.houses.update(px, pz)
  }
  // CBD windows light up after dusk
  cityRef.value?.towers.setNight(nightFactor.value)
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
      :material="cityRef.mats[m.bucket]"
      cast-shadow
      receive-shadow
    />
    <primitive v-for="(h, i) in cityRef.houses.objects" :key="'kh' + i" :object="h" />
    <primitive v-if="cityRef.civic" :object="cityRef.civic" />
    <primitive v-for="(t, i) in cityRef.towers.meshes" :key="'kt' + i" :object="t" />
    <TresMesh v-for="(w, i) in cityRef.water" :key="'kw' + i" :geometry="w" :material="cityRef.waterMaterial" />
    <TresSprite v-for="(s, i) in cityRef.sprites" :key="'ks' + i" :position="[s.x, s.y, s.z]" :scale="[s.w, s.h, 1]">
      <TresSpriteMaterial :map="s.texture" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
