// CBD skyline: textured high-rises (30 - 125 m) with curtain-wall glass or
// punched-window concrete facades, a two-storey retail podium, setbacks on
// the tallest towers, rooftop crowns and red aviation lights. Windows light
// up at night through an emissive map. Everything merges into three meshes.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TOWERS, mulberry32 } from './kadunaExtras'

const BAY = 3 // m per window bay
const FLOOR = 3.6 // m per storey
const CELLS = 8 // texture holds 8 x 8 bays so lit windows vary

function facadeTextures(glass: boolean): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const px = 32
  const size = px * CELLS
  const rnd = mulberry32(glass ? 0x61a55 : 0xc0c0)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const e = document.createElement('canvas')
  e.width = e.height = size
  const ge = e.getContext('2d')!
  ge.fillStyle = '#000'
  ge.fillRect(0, 0, size, size)
  for (let i = 0; i < CELLS; i++) {
    for (let j = 0; j < CELLS; j++) {
      const x = i * px
      const y = j * px
      if (glass) {
        // tinted blue-green glazing with a sky reflection gradient
        const grd = g.createLinearGradient(x, y, x + px, y + px)
        const t = 0.85 + rnd() * 0.25
        grd.addColorStop(0, `rgb(${Math.round(120 * t)},${Math.round(160 * t)},${Math.round(178 * t)})`)
        grd.addColorStop(1, `rgb(${Math.round(70 * t)},${Math.round(104 * t)},${Math.round(124 * t)})`)
        g.fillStyle = grd
        g.fillRect(x, y, px, px)
        g.fillStyle = '#3a4650' // spandrel band
        g.fillRect(x, y + px - 6, px, 6)
        g.fillStyle = '#c8ccd0' // mullions
        g.fillRect(x, y, 2, px)
        g.fillRect(x, y + px - 7, px, 1)
      } else {
        g.fillStyle = '#d9d3c6' // concrete / render
        g.fillRect(x, y, px, px)
        g.fillStyle = '#2c3842'
        g.fillRect(x + 6, y + 6, px - 12, px - 14)
        g.fillStyle = '#eeeae2'
        g.fillRect(x + 5, y + px - 8, px - 10, 2) // sill
      }
      if (rnd() < 0.55) {
        const warm = rnd() < 0.7
        ge.fillStyle = warm ? '#ffd690' : '#d8ecff'
        if (glass) ge.fillRect(x + 2, y, px - 2, px - 7)
        else ge.fillRect(x + 6, y + 6, px - 12, px - 14)
      }
    }
  }
  const map = new THREE.CanvasTexture(c)
  const emissive = new THREE.CanvasTexture(e)
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 4
  }
  map.colorSpace = THREE.SRGBColorSpace
  emissive.colorSpace = THREE.SRGBColorSpace
  return { map, emissive }
}

/** Box with facade UVs in "bay" units so the texture tiles one window per bay. */
function facadeBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  const uv = g.attributes.uv as THREE.BufferAttribute
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const widths = [d, d, 0, 0, w, w]
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      if (widths[f] === 0) {
        uv.setXY(i, 0.01, 0.01)
      } else {
        uv.setXY(i, (uv.getX(i) * widths[f]) / (BAY * CELLS), (uv.getY(i) * h) / (FLOOR * CELLS) + y / 97)
      }
    }
  }
  g.translate(x, y, z)
  return g
}

function coloured(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.deleteAttribute('uv')
  const c = new THREE.Color(color)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

export interface TowerSet {
  meshes: THREE.Mesh[]
  glassMat: THREE.MeshStandardMaterial
  concreteMat: THREE.MeshStandardMaterial
  /** 0 = day, 1 = full night */
  setNight: (n: number) => void
}

export function buildTowerMeshes(): TowerSet {
  const glassFaces: THREE.BufferGeometry[] = []
  const concreteFaces: THREE.BufferGeometry[] = []
  const trim: THREE.BufferGeometry[] = []
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y, z)
    trim.push(coloured(g, color))
  }
  const cyl = (r: number, h: number, x: number, y: number, z: number, color: string) => {
    const g = new THREE.CylinderGeometry(r, r, h, 8)
    g.translate(x, y, z)
    trim.push(coloured(g, color))
  }

  for (const t of TOWERS) {
    const faces = t.glass ? glassFaces : concreteFaces
    const podH = FLOOR * 2
    // retail podium: wider, glazed shopfront, canopy
    box(t.w + 8, podH, t.d + 8, t.x, podH / 2, t.z, '#cfc9bc')
    box(t.w + 8.2, 2.8, t.d + 8.2, t.x, 1.6, t.z, '#43535e')
    box(t.w + 9.5, 0.3, t.d + 9.5, t.x, 3.3, t.z, '#e8e4dc')
    box(t.w + 8.4, 0.5, t.d + 8.4, t.x, podH + 0.25, t.z, '#e8e4dc')
    const shaftH = t.h - podH
    if (t.h > 70) {
      // setback: lower 65 % full plan, upper section narrower
      const h1 = Math.round((shaftH * 0.65) / FLOOR) * FLOOR
      const h2 = shaftH - h1
      faces.push(facadeBox(t.w, h1, t.d, t.x, podH + h1 / 2, t.z))
      box(t.w + 0.6, 0.6, t.d + 0.6, t.x, podH + h1 + 0.3, t.z, '#e8e4dc')
      faces.push(facadeBox(t.w * 0.72, h2, t.d * 0.72, t.x, podH + h1 + h2 / 2, t.z))
      box(t.w * 0.72 + 0.6, 1.4, t.d * 0.72 + 0.6, t.x, t.h + 0.7, t.z, '#e8e4dc')
      // crown fins + mast
      for (const s of [-1, 1]) box(0.5, 6, t.d * 0.72, t.x + s * t.w * 0.33, t.h + 3, t.z, '#d8dce0')
      cyl(0.18, 14, t.x, t.h + 8, t.z, '#9aa0a6')
      cyl(0.45, 0.6, t.x, t.h + 15.2, t.z, '#ff3b30')
    } else {
      faces.push(facadeBox(t.w, shaftH, t.d, t.x, podH + shaftH / 2, t.z))
      box(t.w + 0.6, 1.2, t.d + 0.6, t.x, t.h + 0.6, t.z, '#e8e4dc')
      // rooftop plant room + water tanks + aviation light
      box(t.w * 0.4, 3, t.d * 0.35, t.x - t.w * 0.15, t.h + 2.7, t.z, '#b8b4aa')
      cyl(0.9, 1.8, t.x + t.w * 0.25, t.h + 2.1, t.z + t.d * 0.2, '#1f2124')
      cyl(0.9, 1.8, t.x + t.w * 0.25, t.h + 2.1, t.z - t.d * 0.2, '#1f2124')
      cyl(0.35, 0.5, t.x - t.w * 0.15, t.h + 4.5, t.z, '#ff3b30')
    }
  }

  const glassTex = facadeTextures(true)
  const concTex = facadeTextures(false)
  const glassMat = new THREE.MeshStandardMaterial({
    map: glassTex.map,
    emissiveMap: glassTex.emissive,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0,
    roughness: 0.18,
    metalness: 0.55
  })
  const concreteMat = new THREE.MeshStandardMaterial({
    map: concTex.map,
    emissiveMap: concTex.emissive,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0,
    roughness: 0.85,
    metalness: 0.0
  })
  const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true })

  const meshes: THREE.Mesh[] = []
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (!geos.length) return
    const merged = mergeGeometries(geos, false)
    for (const g of geos) g.dispose()
    if (!merged) return
    merged.computeBoundingSphere()
    const m = new THREE.Mesh(merged, mat)
    m.castShadow = true
    m.receiveShadow = true
    meshes.push(m)
  }
  add(glassFaces, glassMat)
  add(concreteFaces, concreteMat)
  add(trim, trimMat)

  return {
    meshes,
    glassMat,
    concreteMat,
    setNight(n: number) {
      const k = Math.max(0, (n - 0.25) / 0.75)
      glassMat.emissiveIntensity = k * 1.1
      concreteMat.emissiveIntensity = k * 1.0
    }
  }
}
