// Modern Kaduna housing: a handful of detailed house prefabs drawn with
// GPU instancing instead of one merged box per house.
//
// Every house in BAKE.houses resolves (deterministically) to a prefab type,
// a facing (front door toward the nearest street), a wall tint and a roof
// tint. Prefabs are authored once at a nominal 14 x 12 m footprint with the
// front on local +Z; each instance is scaled to its own footprint.
//
// The look follows what you actually see across Barnawa, Malali, Ungwan
// Rimi and Millennium City today: two-storey duplexes with flat parapet
// roofs and balconies, stone-coated hip roofs, compound fences with steel
// gates, black "Geepee" water tanks, AC units, solar panels, blocks of
// flats and roadside shop rows with roller shutters.

import * as THREE from 'three'
import { BAKE, roadWidth, SIDEWALK_W } from './kaduna'
import { hash01, hashDist, roadHash, OPEN_HOUSES } from './kadunaExtras'

export const NW = 14 // nominal prefab footprint (x)
export const ND = 12 // nominal prefab footprint (z)

export type HouseType = 'duplex' | 'bungalow' | 'flats' | 'hipduplex' | 'shops' | 'open'

export interface HouseWindow {
  /** local center (nominal prefab space) */
  x: number
  y: number
  z: number
  /** outward normal in local space (axis aligned) */
  nx: number
  nz: number
  w: number
  h: number
}

export interface HousePlacement {
  x: number
  z: number
  yaw: number
  sx: number
  sz: number
  type: HouseType
  wall: string
  roof: string
}

// light, sun-friendly Nigerian wall palette + a few bold accent colours
export const WALL_TINTS = [
  '#efe8d8', '#f4f1ea', '#e9dcb8', '#d9e4e6', '#e6d2b5', '#cfd8c4', '#f0e2c8', '#e2d6cc', '#d8d2c6', '#c9d6dc',
  '#b8c4b0', '#e8c9a8'
]
// stone-coated roof tiles: charcoal, terracotta, forest green, burgundy, slate
export const ROOF_TINTS = ['#3c3f45', '#5a5f66', '#7a4a36', '#3f5a48', '#6a3438', '#4a5a6a', '#8a6a4a']

// ------------------------------------------------------------- prefab builder
interface Part {
  geo: THREE.BufferGeometry
  color: string
  /** 0 = fixed colour, 1 = wall tint, 2 = roof tint */
  tint: 0 | 1 | 2
}

class Builder {
  parts: Part[] = []
  windows: HouseWindow[] = []

  add(geo: THREE.BufferGeometry, color: string, tint: 0 | 1 | 2 = 0) {
    this.parts.push({ geo, color, tint })
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, tint: 0 | 1 | 2 = 0) {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y, z)
    this.add(g, color, tint)
  }
  cyl(r: number, h: number, x: number, y: number, z: number, color: string, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, h, seg)
    g.translate(x, y, z)
    this.add(g, color)
  }
  /** rectangular hip roof (4-sided pyramid stretched to w x d) */
  hip(w: number, d: number, h: number, x: number, y: number, z: number) {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, h, 4, 1)
    g.rotateY(Math.PI / 4)
    g.scale(w, 1, d)
    g.translate(x, y + h / 2, z)
    this.add(g, '#ffffff', 2)
    // fascia board under the eaves
    this.box(w + 0.1, 0.25, d + 0.1, x, y - 0.05, z, '#e8e4dc')
  }
  /** a glazed window on a facade, recorded for the night glow pass */
  win(x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, glow = true) {
    const t = 0.08
    const gw = nx !== 0 ? t : w
    const gd = nx !== 0 ? w : t
    this.box(gw, h, gd, x + nx * 0.03, y, z + nz * 0.03, '#26343f')
    // light sill
    const fw = nx !== 0 ? 0.1 : w + 0.24
    const fd = nx !== 0 ? w + 0.24 : 0.1
    this.box(fw, 0.12, fd, x + nx * 0.06, y - h / 2 - 0.06, z + nz * 0.06, '#f2efe8')
    if (glow) this.windows.push({ x: x + nx * 0.1, y, z: z + nz * 0.1, nx, nz, w, h })
  }
  /** a row of windows along a facade */
  winRow(face: 'front' | 'back' | 'left' | 'right', cx: number, cz: number, halfW: number, halfD: number, y: number, n: number, w: number, h: number) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5
      if (face === 'front') this.win(cx + t * halfW * 2, y, cz + halfD, 0, 1, w, h)
      if (face === 'back') this.win(cx + t * halfW * 2, y, cz - halfD, 0, -1, w, h)
      if (face === 'left') this.win(cx - halfW, y, cz + t * halfD * 2, -1, 0, w, h)
      if (face === 'right') this.win(cx + halfW, y, cz + t * halfD * 2, 1, 0, w, h)
    }
  }
  door(x: number, z: number, w = 1.2, h = 2.3) {
    this.box(w, h, 0.12, x, h / 2, z + 0.04, '#4a3424')
    this.box(w + 0.3, 0.14, 0.14, x, h + 0.08, z + 0.06, '#f2efe8')
  }
  /** compound wall around the whole footprint with a steel gate in front */
  fence(gateW = 4.4) {
    const H = 2.2
    const T = 0.24
    const hw = NW / 2 - T / 2
    const hd = ND / 2 - T / 2
    this.box(NW, H, T, 0, H / 2, -hd, '#ffffff', 1)
    this.box(T, H, ND, -hw, H / 2, 0, '#ffffff', 1)
    this.box(T, H, ND, hw, H / 2, 0, '#ffffff', 1)
    const seg = (NW - gateW) / 2
    this.box(seg, H, T, -NW / 2 + seg / 2, H / 2, hd, '#ffffff', 1)
    this.box(seg, H, T, NW / 2 - seg / 2, H / 2, hd, '#ffffff', 1)
    // coping
    this.box(NW + 0.1, 0.12, 0.34, 0, H + 0.06, -hd, '#d8d2c4')
    this.box(0.34, 0.12, ND, -hw, H + 0.06, 0, '#d8d2c4')
    this.box(0.34, 0.12, ND, hw, H + 0.06, 0, '#d8d2c4')
    this.box(seg, 0.12, 0.34, -NW / 2 + seg / 2, H + 0.06, hd, '#d8d2c4')
    this.box(seg, 0.12, 0.34, NW / 2 - seg / 2, H + 0.06, hd, '#d8d2c4')
    // gate pillars + sliding steel gate
    this.box(0.55, H + 0.5, 0.55, -gateW / 2, (H + 0.5) / 2, hd, '#d8d2c4')
    this.box(0.55, H + 0.5, 0.55, gateW / 2, (H + 0.5) / 2, hd, '#d8d2c4')
    this.box(gateW - 0.5, H - 0.1, 0.1, 0, (H - 0.1) / 2 + 0.05, hd, '#23272e')
    // interlocking-paved yard
    this.box(NW - 0.5, 0.06, ND - 0.5, 0, 0.03, 0, '#a9a297')
  }
  geometry(): THREE.BufferGeometry {
    const geos: THREE.BufferGeometry[] = []
    for (const p of this.parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo
      g.deleteAttribute('uv')
      const n = g.attributes.position.count
      const col = new Float32Array(n * 3)
      const mask = new Float32Array(n * 2)
      const c = new THREE.Color(p.color)
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
        mask[i * 2] = p.tint === 1 ? 1 : 0
        mask[i * 2 + 1] = p.tint === 2 ? 1 : 0
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      g.setAttribute('tintMask', new THREE.BufferAttribute(mask, 2))
      geos.push(g)
    }
    const merged = mergeAll(geos)
    merged.computeBoundingSphere()
    return merged
  }
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const out = new THREE.BufferGeometry()
  const names = ['position', 'normal', 'color', 'tintMask'] as const
  const sizes = { position: 3, normal: 3, color: 3, tintMask: 2 }
  for (const name of names) {
    const arr = new Float32Array(total * sizes[name])
    let off = 0
    for (const g of geos) {
      const a = g.attributes[name].array as Float32Array
      arr.set(a, off)
      off += a.length
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, sizes[name]))
  }
  for (const g of geos) g.dispose()
  return out
}

// ------------------------------------------------------------- the prefabs
const FLOOR = 3.3

function extras(b: Builder, top: number, x: number, z: number, solar: boolean) {
  // black water tank on a little stand, the AC condenser, maybe solar
  b.box(1.6, 0.5, 1.6, x, top + 0.25, z, '#9a958a')
  b.cyl(0.75, 1.5, x, top + 1.25, z, '#1f2124', 12)
  b.cyl(0.3, 0.12, x, top + 2.06, z, '#2a2c30', 8)
  if (solar) {
    const g = new THREE.BoxGeometry(3.4, 0.08, 1.9)
    g.rotateX(-0.35)
    g.translate(-x * 0.6, top + 0.75, z + 0.6)
    b.add(g, '#1b2a4a')
    b.box(0.08, 0.8, 0.08, -x * 0.6 - 1.5, top + 0.4, z + 0.2, '#8a8f96')
    b.box(0.08, 0.8, 0.08, -x * 0.6 + 1.5, top + 0.4, z + 0.2, '#8a8f96')
  }
}

function buildDuplex(): Builder {
  const b = new Builder()
  b.fence()
  const W = 10.4
  const D = 7.6
  const cz = -1.4
  const H = FLOOR * 2
  b.box(W, H, D, 0, H / 2, cz, '#ffffff', 1)
  // accent band between the floors + plinth
  b.box(W + 0.12, 0.3, D + 0.12, 0, FLOOR, cz, '#ffffff', 2)
  b.box(W + 0.1, 0.45, D + 0.1, 0, 0.22, cz, '#8f8a80')
  // flat roof with parapet
  b.box(W + 0.3, 0.9, D + 0.3, 0, H + 0.45, cz, '#ffffff', 1)
  b.box(W - 0.4, 0.2, D - 0.4, 0, H + 0.82, cz, '#8a8478')
  // front: door with canopy, big windows, upper balcony
  const fz = cz + D / 2
  b.door(-2.6, fz, 1.3, 2.4)
  b.box(2.6, 0.18, 1.4, -2.6, 2.75, fz + 0.7, '#ffffff', 2)
  b.win(1.6, 1.6, fz, 0, 1, 2.6, 1.5)
  b.win(-2.6, FLOOR + 1.6, fz, 0, 1, 1.4, 1.5)
  b.win(2.4, FLOOR + 1.5, fz, 0, 1, 2.8, 2.2)
  // balcony slab + glass balustrade with steel rail
  b.box(4.4, 0.22, 1.6, 2.4, FLOOR + 0.1, fz + 0.8, '#d8d2c4')
  b.box(4.4, 1.0, 0.06, 2.4, FLOOR + 0.7, fz + 1.58, '#9fc0cc')
  b.box(4.5, 0.08, 0.1, 2.4, FLOOR + 1.22, fz + 1.58, '#2a2c30')
  // sides + back
  b.winRow('left', 0, cz, W / 2, D / 2, 1.6, 2, 1.2, 1.3)
  b.winRow('left', 0, cz, W / 2, D / 2, FLOOR + 1.6, 2, 1.2, 1.3)
  b.winRow('right', 0, cz, W / 2, D / 2, 1.6, 2, 1.2, 1.3)
  b.winRow('right', 0, cz, W / 2, D / 2, FLOOR + 1.6, 2, 1.2, 1.3)
  b.winRow('back', 0, cz, W / 2, D / 2, FLOOR + 1.6, 3, 1.1, 1.2)
  // AC condenser on the side wall
  b.box(0.9, 0.65, 0.45, W / 2 + 0.25, FLOOR + 0.6, cz - 1.2, '#e8e8e4')
  extras(b, H + 0.92, 2.8, cz - 1.8, true)
  // parked car pad
  b.box(3.2, 0.05, 4.6, 3.6, 0.07, 3.6, '#8a857c')
  return b
}

function buildBungalow(): Builder {
  const b = new Builder()
  b.fence(4.0)
  const W = 10.8
  const D = 8.0
  const cz = -1.2
  const H = 3.8
  b.box(W, H, D, 0, H / 2, cz, '#ffffff', 1)
  b.box(W + 0.1, 0.45, D + 0.1, 0, 0.22, cz, '#8f8a80')
  b.hip(W + 1.2, D + 1.2, 2.3, 0, H, cz)
  const fz = cz + D / 2
  // porch: slab, two columns, the hip roof eave covers it
  b.box(4.2, 0.3, 1.8, -1.8, 0.15, fz + 0.9, '#cfc8ba')
  b.box(0.35, H - 0.3, 0.35, -3.6, (H - 0.3) / 2 + 0.3, fz + 1.5, '#f2efe8')
  b.box(0.35, H - 0.3, 0.35, 0, (H - 0.3) / 2 + 0.3, fz + 1.5, '#f2efe8')
  b.door(-1.8, fz)
  b.win(2.6, 1.7, fz, 0, 1, 2.4, 1.4)
  b.winRow('left', 0, cz, W / 2, D / 2, 1.7, 2, 1.2, 1.3)
  b.winRow('right', 0, cz, W / 2, D / 2, 1.7, 2, 1.2, 1.3)
  b.winRow('back', 0, cz, W / 2, D / 2, 1.7, 3, 1.1, 1.2)
  b.box(0.9, 0.65, 0.45, -W / 2 - 0.25, 1.2, cz, '#e8e8e4')
  // water tank on a steel stand in the yard
  b.box(0.12, 3.2, 0.12, 5.2, 1.6, -4.6, '#6b6f75')
  b.box(0.12, 3.2, 0.12, 6.0, 1.6, -4.6, '#6b6f75')
  b.box(1.2, 0.12, 1.2, 5.6, 3.2, -4.6, '#6b6f75')
  b.cyl(0.6, 1.3, 5.6, 3.9, -4.6, '#1f2124', 12)
  return b
}

function buildHipDuplex(): Builder {
  const b = new Builder()
  b.fence()
  const W = 10.6
  const D = 8.0
  const cz = -1.4
  const H = FLOOR * 2
  b.box(W, H, D, 0, H / 2, cz, '#ffffff', 1)
  b.box(W + 0.12, 0.3, D + 0.12, 0, FLOOR, cz, '#e8e2d6')
  b.box(W + 0.1, 0.45, D + 0.1, 0, 0.22, cz, '#8f8a80')
  b.hip(W + 1.4, D + 1.4, 2.6, 0, H, cz)
  const fz = cz + D / 2
  // double-height portico: four round columns + pediment slab
  for (const px of [-3.2, -1.1, 1.1, 3.2]) b.cyl(0.24, H - 0.2, px, (H - 0.2) / 2 + 0.25, fz + 1.7, '#f4f1ea', 12)
  b.box(7.6, 0.5, 2.2, 0, H - 0.1, fz + 1.1, '#f4f1ea')
  b.box(7.6, 0.25, 2.2, 0, 0.12, fz + 1.1, '#cfc8ba')
  b.door(0, fz, 1.8, 2.6)
  b.win(-3.4, 1.7, fz, 0, 1, 1.6, 1.5)
  b.win(3.4, 1.7, fz, 0, 1, 1.6, 1.5)
  b.win(-3.4, FLOOR + 1.7, fz, 0, 1, 1.6, 1.5)
  b.win(0, FLOOR + 1.7, fz, 0, 1, 1.6, 1.5)
  b.win(3.4, FLOOR + 1.7, fz, 0, 1, 1.6, 1.5)
  b.winRow('left', 0, cz, W / 2, D / 2, 1.7, 2, 1.2, 1.3)
  b.winRow('right', 0, cz, W / 2, D / 2, FLOOR + 1.7, 2, 1.2, 1.3)
  b.winRow('back', 0, cz, W / 2, D / 2, FLOOR + 1.7, 3, 1.1, 1.2)
  b.box(0.9, 0.65, 0.45, W / 2 + 0.25, 1.3, cz + 1.4, '#e8e8e4')
  b.box(3.2, 0.05, 4.6, -4.2, 0.07, 3.6, '#8a857c')
  return b
}

function buildFlats(): Builder {
  const b = new Builder()
  const W = 13.0
  const D = 10.4
  const cz = -0.4
  const floors = 3
  const H = FLOOR * floors
  b.box(W, H, D, 0, H / 2, cz, '#ffffff', 1)
  b.box(W + 0.1, 0.5, D + 0.1, 0, 0.25, cz, '#8f8a80')
  b.box(W + 0.3, 1.0, D + 0.3, 0, H + 0.5, cz, '#ffffff', 1)
  b.box(W - 0.4, 0.2, D - 0.4, 0, H + 0.92, cz, '#8a8478')
  const fz = cz + D / 2
  // central stair core, slightly proud, with a tall slot window
  b.box(2.6, H + 1.8, 1.2, 0, (H + 1.8) / 2, fz + 0.4, '#ffffff', 2)
  b.box(0.7, H - 1.2, 0.08, 0, H / 2 + 0.5, fz + 1.02, '#26343f')
  b.door(0, fz + 1.0, 1.4, 2.3)
  for (let f = 0; f < floors; f++) {
    const y0 = f * FLOOR
    for (const sx of [-1, 1]) {
      const bx = sx * 4.1
      b.win(bx, y0 + 1.5, fz, 0, 1, 2.6, 1.9)
      if (f > 0) {
        b.box(4.2, 0.2, 1.4, bx, y0 + 0.1, fz + 0.7, '#d8d2c4')
        b.box(4.2, 1.0, 0.08, bx, y0 + 0.7, fz + 1.38, '#ffffff', 2)
      }
    }
    b.winRow('left', 0, cz, W / 2, D / 2, y0 + 1.6, 3, 1.1, 1.3)
    b.winRow('right', 0, cz, W / 2, D / 2, y0 + 1.6, 3, 1.1, 1.3)
    b.winRow('back', 0, cz, W / 2, D / 2, y0 + 1.6, 4, 1.1, 1.3)
    b.box(0.9, 0.65, 0.45, W / 2 + 0.25, y0 + 1.0, cz - 2.5, '#e8e8e4')
  }
  extras(b, H + 1.0, 3.6, cz - 2.2, false)
  b.cyl(0.75, 1.5, -3.6, H + 1.0 + 1.25, cz - 2.2, '#1f2124', 12)
  // forecourt parking
  b.box(NW - 0.4, 0.05, 1.4, 0, 0.04, ND / 2 - 0.5, '#8a857c')
  return b
}

function buildShops(): Builder {
  const b = new Builder()
  const W = 13.4
  const D = 10.6
  const cz = -0.5
  const g = 3.8
  const H = g + FLOOR
  b.box(W, H, D, 0, H / 2, cz, '#ffffff', 1)
  b.box(W + 0.3, 0.9, D + 0.3, 0, H + 0.45, cz, '#ffffff', 1)
  const fz = cz + D / 2
  // shop bays: roller shutters (some open, showing a lit interior)
  const bays = 3
  const SHUT = ['#3f6fae', '#2f7d5b', '#b04a3a', '#8a8f96', '#d8a23c']
  for (let i = 0; i < bays; i++) {
    const x = -W / 2 + (i + 0.5) * (W / bays)
    const open = i === 1
    b.box(W / bays - 0.7, 2.9, 0.1, x, 1.55, fz + 0.04, open ? '#2a2620' : SHUT[i % SHUT.length])
    if (open) b.windows.push({ x, y: 1.55, z: fz + 0.12, nx: 0, nz: 1, w: W / bays - 0.9, h: 2.6 })
    b.box(0.3, g, 0.3, -W / 2 + i * (W / bays), g / 2, fz + 0.1, '#d8d2c4')
  }
  // signboard band + canopy over the walkway
  b.box(W + 0.1, 0.8, 0.14, 0, g - 0.1, fz + 0.12, '#f4f1ea')
  b.box(W + 0.4, 0.15, 2.0, 0, g - 0.6, fz + 1.0, '#ffffff', 2)
  b.box(W + 0.2, 0.12, 2.6, 0, 0.06, fz + 1.3, '#bdb6a8')
  // residential floor above
  b.winRow('front', 0, cz, W / 2, D / 2, g + 1.6, 4, 1.6, 1.4)
  b.winRow('left', 0, cz, W / 2, D / 2, g + 1.6, 2, 1.2, 1.3)
  b.winRow('right', 0, cz, W / 2, D / 2, g + 1.6, 2, 1.2, 1.3)
  b.winRow('back', 0, cz, W / 2, D / 2, 1.6, 3, 1.1, 1.2)
  b.winRow('back', 0, cz, W / 2, D / 2, g + 1.6, 3, 1.1, 1.2)
  extras(b, H + 0.9, -3.6, cz - 2.4, false)
  return b
}

function buildOpen(): Builder {
  // enterable homes: the body fills the footprint so the interior door
  // (drawn by Interiors.vue on the footprint edge) sits on the facade
  const b = new Builder()
  const W = NW
  const D = ND
  const H = 3.9
  b.box(W, H, D, 0, H / 2, 0, '#ffffff', 1)
  b.box(W + 0.1, 0.45, D + 0.1, 0, 0.22, 0, '#8f8a80')
  b.box(W + 0.3, 0.8, D + 0.3, 0, H + 0.4, 0, '#ffffff', 2)
  b.win(-4.2, 1.8, D / 2, 0, 1, 2.2, 1.4)
  b.win(4.2, 1.8, D / 2, 0, 1, 2.2, 1.4)
  b.winRow('left', 0, 0, W / 2, D / 2, 1.8, 3, 1.2, 1.3)
  b.winRow('right', 0, 0, W / 2, D / 2, 1.8, 3, 1.2, 1.3)
  b.winRow('back', 0, 0, W / 2, D / 2, 1.8, 3, 1.2, 1.3)
  extras(b, H + 0.8, 3.4, -2.6, true)
  return b
}

const BUILDERS: Record<HouseType, () => Builder> = {
  duplex: buildDuplex,
  bungalow: buildBungalow,
  flats: buildFlats,
  hipduplex: buildHipDuplex,
  shops: buildShops,
  open: buildOpen
}
export const HOUSE_TYPES = Object.keys(BUILDERS) as HouseType[]

interface Prefab {
  geometry: THREE.BufferGeometry
  windows: HouseWindow[]
}
let _prefabs: Record<HouseType, Prefab> | null = null
export function prefabs(): Record<HouseType, Prefab> {
  if (!_prefabs) {
    const out = {} as Record<HouseType, Prefab>
    for (const t of HOUSE_TYPES) {
      const b = BUILDERS[t]()
      out[t] = { geometry: b.geometry(), windows: b.windows }
    }
    _prefabs = out
  }
  return _prefabs
}

// ------------------------------------------------------------- placement
let _mainRoads: { x: number; z: number }[] | null = null
function mainRoadDist(x: number, z: number): number {
  if (!_mainRoads) {
    _mainRoads = []
    for (const r of BAKE.roads) {
      if (r.class !== 'trunk' && r.class !== 'primary') continue
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i]
        const [bx, bz] = r.pts[i + 1]
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10))
        for (let k = 0; k < n; k++) _mainRoads.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n })
      }
    }
  }
  let best = Infinity
  for (const p of _mainRoads) {
    const dx = p.x - x
    const dz = p.z - z
    if (Math.abs(dx) > 60 || Math.abs(dz) > 60) continue
    const d = Math.hypot(dx, dz)
    if (d < best) best = d
  }
  return best
}


let _placements: HousePlacement[] | null = null
export function housePlacements(): HousePlacement[] {
  if (_placements) return _placements
  const out: HousePlacement[] = []
  // enterable homes keep their cardinal door (Interiors.vue relies on it)
  const openKeys = new Map(OPEN_HOUSES.map((h) => [`${h.x}:${h.z}`, Math.atan2(h.nx, h.nz)]))
  const cbd = { x: -60 * 3, z: 30 * 3 }
  for (const [x, z, w, d, rot] of BAKE.houses) {
    const openYaw = openKeys.get(`${x}:${z}`)
    let yaw = rot
    let sx = w / NW
    let sz = d / ND
    let type: HouseType
    if (openYaw !== undefined) {
      type = 'open'
      yaw = openYaw
      const cardinalX = Math.abs(Math.sin(openYaw)) > 0.5
      sx = (cardinalX ? d : w) / NW
      sz = (cardinalX ? w : d) / ND
    } else {
      // face the closest street: probe the four sides of the footprint
      let bestK = 0
      let bestD = Infinity
      for (let k = 0; k < 4; k++) {
        const a = rot + (k * Math.PI) / 2
        const reach = (k % 2 === 0 ? d : w) / 2 + 7
        const dd = hashDist(roadHash(), x + Math.sin(a) * reach, z + Math.cos(a) * reach, 40)
        if (dd < bestD - 0.5) {
          bestD = dd
          bestK = k
        }
      }
      yaw = rot + (bestK * Math.PI) / 2
      if (bestK % 2 === 1) {
        sx = d / NW
        sz = w / ND
      }
      const h = hash01(x, z, 3)
      const main = mainRoadDist(x, z)
      const nearCbd = Math.hypot(x - cbd.x, z - cbd.z) < 900
      if (main < roadWidth('primary') / 2 + SIDEWALK_W + Math.max(w, d) * 0.8 + 4 && h < 0.7) type = 'shops'
      else if (nearCbd && h < 0.4) type = 'flats'
      else if (h < 0.36) type = 'duplex'
      else if (h < 0.62) type = 'bungalow'
      else if (h < 0.82) type = 'hipduplex'
      else if (h < 0.9) type = 'flats'
      else type = 'duplex'
    }
    out.push({
      x,
      z,
      yaw,
      sx,
      sz,
      type,
      wall: WALL_TINTS[Math.floor(hash01(x, z, 17) * WALL_TINTS.length)],
      roof: ROOF_TINTS[Math.floor(hash01(x, z, 29) * ROOF_TINTS.length)]
    })
  }
  _placements = out
  return out
}

// ------------------------------------------------------------- rendering
/** Lambert material whose vertex colours are tinted per instance: the wall
 *  mask takes `instanceColor`, the roof mask takes the `iRoof` attribute,
 *  everything else keeps its authored colour. */
export function makeHouseMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 tintMask;\nattribute vec3 iRoof;'
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  vColor.xyz /= max(instanceColor.xyz, vec3(0.001));
  vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, tintMask.x) * mix(vec3(1.0), iRoof, tintMask.y);
#endif`
      )
  }
  m.customProgramCacheKey = () => 'kk-house-tint-v1'
  return m
}

// ------------------------------------------------------------- LOD
// ~30k compounds is far too much detailed geometry to draw at once, so:
//   near (< HI_R)  detailed prefab, per small tile + type, casts shadows
//   far            a two-part massing model (tinted body + roof), one
//                  instanced mesh per big tile, no shadows
// A house drawn in detail is collapsed to zero scale in its far mesh.
const HI_TILE = 192
const LO_TILE = HI_TILE * 6
const TYPE_H: Record<HouseType, number> = { duplex: 7.5, bungalow: 3.9, flats: 10.9, hipduplex: 6.6, shops: 8.0, open: 4.7 }
const TYPE_HIP: Record<HouseType, boolean> = { duplex: false, bungalow: true, flats: false, hipduplex: true, shops: false, open: false }

function loGeometry(hip: boolean): THREE.BufferGeometry {
  const b = new Builder()
  // unit massing: body 1 x 1 x 1 standing on y = 0 (scaled per instance)
  b.box(0.8, 1, 0.68, 0, 0.5, -0.08, '#ffffff', 1)
  if (hip) {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 0.32, 4, 1)
    g.rotateY(Math.PI / 4)
    g.scale(0.88, 1, 0.76)
    g.translate(0, 1.16, -0.08)
    b.add(g, '#ffffff', 2)
  }
  return b.geometry()
}

interface HiTile {
  mesh: THREE.InstancedMesh
  cx: number
  cz: number
  /** [loMesh, loIndex] per instance */
  lo: Array<[LoTile, number]>
  near: boolean
}
interface LoTile {
  mesh: THREE.InstancedMesh
  cx: number
  cz: number
  matrices: Float32Array // the "far" matrices to restore
}

export interface HouseSystem {
  objects: THREE.InstancedMesh[]
  update: (px: number, pz: number) => void
}

export function buildHouseSystem(material: THREE.Material, hiRadius = 300, loRadius = 2000): HouseSystem {
  const P = prefabs()
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const col = new THREE.Color()

  const place = housePlacements()
  const hiGroups = new Map<string, number[]>()
  const loGroups = new Map<string, number[]>()
  place.forEach((p, i) => {
    const hk = `${Math.floor(p.x / HI_TILE)},${Math.floor(p.z / HI_TILE)},${p.type}`
    const lk = `${Math.floor(p.x / LO_TILE)},${Math.floor(p.z / LO_TILE)},${TYPE_HIP[p.type] ? 1 : 0}`
    ;(hiGroups.get(hk) ?? hiGroups.set(hk, []).get(hk)!).push(i)
    ;(loGroups.get(lk) ?? loGroups.set(lk, []).get(lk)!).push(i)
  })

  // per-mesh geometry that SHARES the prefab's vertex buffers (no copy) and
  // only owns its per-instance roof colours - cloning the prefab for every
  // tile cost ~600 MB of RAM
  const shareGeo = (base: THREE.BufferGeometry) => {
    const g = new THREE.BufferGeometry()
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name))
    g.boundingSphere = base.boundingSphere
    return g
  }
  const fill = (mesh: THREE.InstancedMesh, list: number[], lo: boolean) => {
    const roof = new Float32Array(list.length * 3)
    let sx = 0
    let sz = 0
    list.forEach((pi, i) => {
      const p = place[pi]
      q.setFromAxisAngle(up, p.yaw)
      if (lo) scl.set(p.sx * NW, TYPE_H[p.type], p.sz * ND)
      else scl.set(p.sx, 1, p.sz)
      m4.compose(pos.set(p.x, 0, p.z), q, scl)
      mesh.setMatrixAt(i, m4)
      mesh.setColorAt(i, col.set(p.wall))
      col.set(p.roof)
      roof[i * 3] = col.r
      roof[i * 3 + 1] = col.g
      roof[i * 3 + 2] = col.b
      sx += p.x
      sz += p.z
    })
    mesh.geometry.setAttribute('iRoof', new THREE.InstancedBufferAttribute(roof, 3))
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    return [sx / list.length, sz / list.length]
  }

  // far massing meshes
  const loGeo = [loGeometry(false), loGeometry(true)]
  const loOf = new Map<number, [LoTile, number]>()
  const loTiles: LoTile[] = []
  for (const [key, list] of loGroups) {
    const hip = key.endsWith(',1') ? 1 : 0
    const mesh = new THREE.InstancedMesh(shareGeo(loGeo[hip]), material, list.length)
    const [cx, cz] = fill(mesh, list, true)
    mesh.receiveShadow = true
    const t: LoTile = { mesh, cx, cz, matrices: (mesh.instanceMatrix.array as Float32Array).slice() }
    loTiles.push(t)
    list.forEach((pi, i) => loOf.set(pi, [t, i]))
  }
  // near detailed meshes
  const hiTiles: HiTile[] = []
  for (const [key, list] of hiGroups) {
    const type = key.split(',')[2] as HouseType
    const mesh = new THREE.InstancedMesh(shareGeo(P[type].geometry), material, list.length)
    const [cx, cz] = fill(mesh, list, false)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = false
    hiTiles.push({ mesh, cx, cz, lo: list.map((pi) => loOf.get(pi)!), near: false })
  }

  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0).elements
  const touched = new Set<LoTile>()
  return {
    objects: [...loTiles.map((t) => t.mesh), ...hiTiles.map((t) => t.mesh)],
    update(px: number, pz: number) {
      touched.clear()
      const hr = hiRadius + HI_TILE * 0.7
      for (const t of hiTiles) {
        const near = Math.hypot(t.cx - px, t.cz - pz) < hr
        if (near === t.near) continue
        t.near = near
        t.mesh.visible = near
        for (const [lo, i] of t.lo) {
          const arr = lo.mesh.instanceMatrix.array as Float32Array
          if (near) arr.set(ZERO, i * 16)
          else arr.set(lo.matrices.subarray(i * 16, i * 16 + 16), i * 16)
          touched.add(lo)
        }
      }
      for (const lo of touched) lo.mesh.instanceMatrix.needsUpdate = true
      for (const lo of loTiles) lo.mesh.visible = Math.hypot(lo.cx - px, lo.cz - pz) < loRadius + LO_TILE * 0.7
    }
  }
}

/** World-space window quads for the night glow pass. */
export function houseWindowQuads(maxPerHouse = 3): {
  x: number; y: number; z: number; rx: number; rz: number; h: number; seed: number
}[] {
  const P = prefabs()
  const out: { x: number; y: number; z: number; rx: number; rz: number; h: number; seed: number }[] = []
  for (const p of housePlacements()) {
    const wins = P[p.type].windows
    const c = Math.cos(p.yaw)
    const s = Math.sin(p.yaw)
    const step = Math.max(1, Math.ceil(wins.length / maxPerHouse))
    for (let i = 0; i < wins.length; i += step) {
      const w = wins[i]
      const lx = w.x * p.sx
      const lz = w.z * p.sz
      const x = p.x + lx * c + lz * s
      const z = p.z - lx * s + lz * c
      // local right vector of the window plane
      const half = (w.w / 2) * (w.nz !== 0 ? p.sx : p.sz)
      const rx = w.nz !== 0 ? c * half : s * half
      const rz = w.nz !== 0 ? -s * half : c * half
      out.push({ x, y: w.y, z, rx, rz, h: w.h / 2, seed: hash01(x, z, 41) })
    }
  }
  return out
}
