// Vehicle geometry factory: one merged, vertex-colored BufferGeometry per
// vehicle class, facing +Z (local +X is the driver's side: Nigeria drives
// on the right in left-hand-drive cars). Shared by TrafficSystem (instanced
// ambient traffic), RideSystem (boardable vehicles + interior rigs) and the
// civic sites.
//
// v2 shapes are built from real side profiles (extruded silhouettes) so a
// car reads as a saloon - bonnet, glasshouse, boot - a danfo as a VW-style
// yellow bus with black stripes and a roof rack, a keke as a tricycle with a
// canvas roof, an okada as a Bajaj-style motorbike, and so on. Doors are
// separate parts so boarding can open them.
import * as THREE from 'three'
import { buildSaloon, CAR_DIMS } from '~/utils/carBody'

export type VehicleKind = 'car' | 'keke' | 'okada' | 'bus' | 'truck' | 'bicycle' | 'boat' | 'plane'

export interface VehicleDoor {
  geo: THREE.BufferGeometry
  /** hinge (or slide origin) in vehicle space */
  hinge: [number, number, number]
  /** 'swing' opens around Y at the hinge, 'slide' moves back along -Z */
  type: 'swing' | 'slide'
}

export interface VehicleSpec {
  /** body without the driver (boardable / parked) */
  geo: THREE.BufferGeometry
  /** body + a seated driver or rider (ambient traffic) */
  geoRider: THREE.BufferGeometry
  /** driver door on the +X side (cars, buses, lorries) */
  door: VehicleDoor | null
  /** collision radius in units */
  radius: number
  maxSpeed: number
  accel: number
  /** cockpit eye: [forward, up] offsets from vehicle center */
  cockpit: [number, number]
  /** driver seat (hip point): [lateral, up, forward] */
  seat: [number, number, number]
  /** straddled (two-wheelers): rider legs hang down both sides */
  straddle: boolean
  /** passenger seats (hip points, same frame as `seat`), front to back */
  passengers: Array<[number, number, number]>
  label: string
}

type Part = [string, THREE.BufferGeometry]

/** Surface finish by part colour: 0 matte (tyres, plastics, cloth),
 *  0.7 paint (clear-coat), 0.9 chrome / lamps, 1 glass. */
function glossOf(hex: string): number {
  const h = hex.toLowerCase()
  if (h === '#ffffff') return 0.7
  if (h === '#1d2730') return 1
  if (h === '#c8ccd2' || h === '#c9ccd1' || h === '#e9eef4' || h === '#9fb3c6' || h === '#d0242e' || h === '#f6f1d8' || h === '#b8262e') return 0.9
  return 0
}

/** Vehicle paint shader: PBR with per-vertex finish (aGloss) so one
 *  material does glossy paint, mirror-dark glass, chrome and matte rubber.
 *  Reflections come from scene.environment (EnvLight). */
export function vehicleMaterial(extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 1.3, ...extra })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGloss;\nvarying float vGloss;\nvarying vec3 vRaw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGloss = aGloss;\nvRaw = color.rgb;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGloss;\nvarying vec3 vRaw;')
      // only the paint takes the per-car tint; glass, rubber, chrome and
      // lamps keep their own colour
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (abs(vGloss - 0.7) > 0.01) diffuseColor.rgb = vRaw;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.82, 0.06, vGloss);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  metalnessFactor = vGloss > 0.85 && vGloss < 0.95 ? 0.85 : vGloss * 0.25;`
      )
  }
  m.customProgramCacheKey = () => 'kk-vehicle-paint'
  return m
}

function build(parts: Part[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []
  const col = new THREE.Color()
  for (const [hex, g] of parts) {
    let gg = g.index ? g.toNonIndexed() : g
    if (gg !== g) g.dispose()
    if (gg.attributes.uv) gg.deleteAttribute('uv')
    if (gg.attributes.uv2) gg.deleteAttribute('uv2')
    if (!gg.attributes.normal) gg.computeVertexNormals()
    col.set(hex)
    const n = gg.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r
      arr[i * 3 + 1] = col.g
      arr[i * 3 + 2] = col.b
    }
    gg = gg.clone()
    gg.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    const gl = glossOf(hex)
    gg.setAttribute('aGloss', new THREE.BufferAttribute(new Float32Array(n).fill(gl), 1))
    geos.push(gg)
  }
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const pos = new Float32Array(total * 3)
  const nrm = new Float32Array(total * 3)
  const ver = new Float32Array(total * 3)
  const gls = new Float32Array(total)
  let goff = 0
  let off = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, off)
    nrm.set(g.attributes.normal.array as Float32Array, off)
    ver.set(g.attributes.color.array as Float32Array, off)
    gls.set(g.attributes.aGloss.array as Float32Array, goff)
    goff += g.attributes.position.count
    off += g.attributes.position.count * 3
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  out.setAttribute('color', new THREE.BufferAttribute(ver, 3))
  out.setAttribute('aGloss', new THREE.BufferAttribute(gls, 1))
  out.computeBoundingSphere()
  return out
}

const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const cyl = (r: number, h: number, x: number, y: number, z: number, seg = 12, rb = r) => new THREE.CylinderGeometry(r, rb, h, seg).translate(x, y, z)
const sph = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 12, 9).scale(sx, sy, sz).translate(x, y, z)

/** Extrude a side silhouette [z, y][] across the width (centred on x). */
function profile(pts: Array<[number, number]>, width: number, bevel = 0.04, x = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1])
  shape.closePath()
  const depth = Math.max(0.01, width - bevel * 2)
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 })
  g.rotateY(-Math.PI / 2)
  g.translate(depth / 2 + x, 0, 0)
  return g
}

/** Tube between two points (bike frames, forks, racks). */
function tube(a: [number, number, number], b: [number, number, number], r: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const len = va.distanceTo(vb)
  const g = new THREE.CylinderGeometry(r, r, len, 8)
  const mid = va.clone().add(vb).multiplyScalar(0.5)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
  g.applyQuaternion(q)
  g.translate(mid.x, mid.y, mid.z)
  return g
}

/** Tyre + rim + hub, axle along X. */
function wheel(r: number, w: number, x: number, y: number, z: number, rim = '#c8ccd2'): Part[] {
  const tyre = new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2).translate(x, y, z)
  const side = x >= 0 ? 1 : -1
  const disc = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 14).rotateZ(Math.PI / 2).translate(x + side * 0.005, y, z)
  const hub = new THREE.CylinderGeometry(r * 0.18, r * 0.18, w + 0.05, 8).rotateZ(Math.PI / 2).translate(x, y, z)
  return [['#161618', tyre], [rim, disc], ['#4a4e54', hub]]
}

/** Thin spoked bike wheel, axle along X. */
function bikeWheel(r: number, z: number, y = r): Part[] {
  const tyre = new THREE.TorusGeometry(r, r * 0.09, 6, 22).rotateY(Math.PI / 2).translate(0, y, z)
  const rimT = new THREE.TorusGeometry(r * 0.86, r * 0.03, 4, 22).rotateY(Math.PI / 2).translate(0, y, z)
  const parts: Part[] = [['#151517', tyre], ['#b8bcc4', rimT]]
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI
    parts.push(['#9aa0a6', tube([0, y + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85], [0, y - Math.cos(a) * r * 0.85, z - Math.sin(a) * r * 0.85], 0.008)])
  }
  parts.push(['#4a4e54', cyl(0.05, 0.12, 0, y, z, 8).rotateZ(Math.PI / 2).translate(0, 0, 0)])
  return parts
}

/** Seated person for ambient traffic, hips at (x, y, z). */
function seated(x: number, y: number, z: number, shirt: string, straddle = false): Part[] {
  const out: Part[] = []
  const skin = '#6e4630'
  const trouser = '#2b3440'
  out.push([shirt, cyl(0.17, 0.5, x, y + 0.3, z, 10, 0.155).scale(1, 1, 1)])
  out.push([shirt, sph(0.18, x, y + 0.54, z, 1.05, 0.42, 0.68)])
  out.push([skin, cyl(0.05, 0.1, x, y + 0.62, z, 8)])
  out.push([skin, sph(0.112, x, y + 0.76, z + 0.01, 0.9, 1.08, 1)])
  out.push(['#141114', sph(0.116, x, y + 0.79, z - 0.005, 0.93, 0.85, 1)])
  for (const s of [-1, 1]) {
    if (straddle) {
      out.push([trouser, tube([x + s * 0.1, y, z], [x + s * 0.2, y - 0.2, z + 0.32], 0.072)])
      out.push([trouser, tube([x + s * 0.2, y - 0.2, z + 0.32], [x + s * 0.2, y - 0.62, z + 0.2], 0.058)])
    } else {
      out.push([trouser, tube([x + s * 0.1, y, z], [x + s * 0.1, y + 0.02, z + 0.42], 0.075)])
      out.push([trouser, tube([x + s * 0.1, y + 0.02, z + 0.42], [x + s * 0.1, y - 0.4, z + 0.5], 0.06)])
    }
    out.push([shirt, tube([x + s * 0.22, y + 0.48, z], [x + s * 0.24, y + 0.26, z + 0.24], 0.05)])
    out.push([skin, tube([x + s * 0.24, y + 0.26, z + 0.24], [x + s * 0.2, y + 0.32, z + 0.5], 0.042)])
  }
  return out
}

function lights(front: number, back: number, y: number, half: number): Part[] {
  return [
    ['#f6f1d8', bx(0.34, 0.14, 0.05, half - 0.28, y, front)],
    ['#f6f1d8', bx(0.34, 0.14, 0.05, -half + 0.28, y, front)],
    ['#b8262e', bx(0.3, 0.14, 0.05, half - 0.24, y + 0.04, back)],
    ['#b8262e', bx(0.3, 0.14, 0.05, -half + 0.24, y + 0.04, back)]
  ]
}

const BODY = '#ffffff' // tinted per instance in traffic
const GLASS = '#1d2730'
const TRIM = '#2a2d33'

/** Body half-length (along heading) and half-width per kind, measured off
 *  the geometry below: the footprint used for vehicle-vs-vehicle collision
 *  (a circle would make cars in neighbouring lanes "touch"). */
export const VEHICLE_HALF: Record<VehicleKind, [number, number]> = {
  car: [2.3, 0.95],
  bus: [2.5, 0.98],
  keke: [1.3, 0.68],
  okada: [1.0, 0.35],
  bicycle: [0.9, 0.3],
  truck: [3.5, 1.17],
  boat: [2.9, 0.95],
  plane: [3.5, 4.6]
}

const cache = new Map<string, VehicleSpec>()

/** 'hi' = full detail (the car you drive / sit in), 'lo' = distant copies:
 * traffic, parked cars, props. Only the car has a separate low model; the
 * other vehicles are already light. */
export type VehicleLod = 'hi' | 'lo'
const LO_DETAIL = 0.3

export function vehicleSpec(kind: VehicleKind, lod: VehicleLod = 'hi'): VehicleSpec {
  const key = kind === 'car' && lod === 'lo' ? 'car_lo' : kind
  const hit = cache.get(key)
  if (hit) return hit
  let parts: Part[] = []
  let rider: Part[] = []
  let door: VehicleDoor | null = null
  let meta: Omit<VehicleSpec, 'geo' | 'geoRider' | 'door'>
  switch (kind) {
    case 'car': {
      // smooth lofted saloon (utils/carBody): curved panels, alloys, LEDs
      const W = CAR_DIMS.W
      parts.push(...buildSaloon(BODY, GLASS, TRIM, key === 'car_lo' ? LO_DETAIL : 1))
      // driver door: the +X front door panel, hinged at its front edge
      door = {
        geo: build([[BODY, bx(0.05, 0.62, 1.12, 0, -0.01, -0.56)], [GLASS, bx(0.04, 0.38, 0.9, 0, 0.5, -0.5)], [TRIM, bx(0.03, 0.04, 0.16, 0.02, 0.1, -0.85)]]),
        hinge: [W / 2 + 0.005, 0.72, 0.98],
        type: 'swing'
      }
      rider = seated(0.4, 0.5, 0.0, '#e8e2d2')
      meta = { radius: 1.7, maxSpeed: 34, accel: 13, cockpit: [0.2, 1.22], seat: [0.4, 0.5, 0.0], straddle: false, passengers: [[-0.4, 0.5, 0.0], [0.38, 0.5, -0.95], [-0.38, 0.5, -0.95]], label: 'Car' }
      break
    }
    case 'bus': {
      // danfo: VW-style van, yellow with black stripes, luggage on the roof
      const W = 1.9
      parts.push(['#e8c12e', profile([[-2.45, 0.36], [-2.45, 1.94], [-2.3, 2.04], [1.95, 2.04], [2.38, 1.62], [2.46, 1.02], [2.46, 0.36]], W, 0.07)])
      parts.push([GLASS, profile([[-2.3, 1.28], [-2.3, 1.86], [1.92, 1.86], [2.3, 1.5], [2.36, 1.28]], W + 0.02, 0.02)])
      parts.push(['#141414', profile([[-2.46, 1.0], [-2.46, 1.12], [2.47, 1.12], [2.47, 1.0]], W + 0.04, 0.01)])
      parts.push(['#141414', profile([[-2.46, 0.6], [-2.46, 0.7], [2.47, 0.7], [2.47, 0.6]], W + 0.04, 0.01)])
      parts.push([TRIM, bx(W + 0.04, 0.24, 0.2, 0, 0.42, 2.48)])
      parts.push([TRIM, bx(W + 0.04, 0.24, 0.2, 0, 0.42, -2.48)])
      parts.push(...lights(2.47, -2.47, 0.85, W / 2))
      // roof rack + luggage (bags, a basin, a jerrycan)
      for (const s of [-1, 1]) parts.push(['#3a3f46', bx(0.05, 0.05, 3.6, s * 0.86, 2.16, -0.2)])
      for (let i = 0; i < 5; i++) parts.push(['#3a3f46', bx(1.76, 0.04, 0.05, 0, 2.16, -1.9 + i * 0.85)])
      parts.push(['#3f6fae', bx(0.7, 0.4, 0.9, -0.35, 2.38, -0.9)])
      parts.push(['#b8433a', bx(0.6, 0.32, 0.6, 0.4, 2.34, 0.2)])
      parts.push(['#c9b18a', cyl(0.35, 0.25, 0.2, 2.31, -1.8, 12, 0.3)])
      parts.push(['#2f7d5b', bx(0.3, 0.45, 0.2, -0.5, 2.4, 0.8)])
      for (const z of [1.62, -1.6]) for (const s of [-1, 1]) parts.push(...wheel(0.38, 0.26, s * 0.84, 0.38, z))
      // sliding passenger door (+X side)
      door = {
        geo: build([['#e8c12e', bx(0.05, 1.5, 1.2, 0, 0, 0)], [GLASS, bx(0.04, 0.55, 1.0, 0.01, 0.42, 0)], ['#141414', bx(0.06, 0.1, 1.2, 0, -0.08, 0)]]),
        hinge: [W / 2 + 0.03, 1.12, 0.5],
        type: 'slide'
      }
      rider = [...seated(0.5, 0.8, 1.45, '#3f6fae'), ...seated(-0.45, 0.85, 0.2, '#b8433a'), ...seated(0.45, 0.85, -0.7, '#e8e2d2')]
      meta = { radius: 2.3, maxSpeed: 24, accel: 9, cockpit: [1.5, 1.6], seat: [0.5, 0.8, 1.45], straddle: false, passengers: [[-0.45, 0.85, 1.45], [-0.45, 0.85, 0.2], [0.45, 0.85, 0.2], [-0.45, 0.85, -0.7], [0.45, 0.85, -0.7], [-0.45, 0.85, -1.6], [0.45, 0.85, -1.6]], label: 'Danfo Bus' }
      break
    }
    case 'keke': {
      // keke NAPEP tricycle: yellow body, green canvas roof, open sides
      parts.push(['#e6b93c', profile([[-1.2, 0.32], [-1.2, 0.98], [0.55, 0.98], [1.1, 0.82], [1.32, 0.48], [1.32, 0.32]], 1.3, 0.05)])
      parts.push(['#e6b93c', profile([[0.7, 0.82], [0.85, 1.55], [1.0, 1.55], [1.2, 0.82]], 1.22, 0.03)]) // cowl / screen frame
      parts.push([GLASS, bx(1.0, 0.6, 0.04, 0, 1.2, 1.0)])
      parts.push(['#2f6e3a', profile([[-1.25, 1.9], [-1.2, 2.06], [0.95, 2.08], [1.08, 1.96], [1.0, 1.9]], 1.36, 0.04)]) // roof
      for (const [px2, pz] of [[0.6, 0.92], [-0.6, 0.92], [0.6, -1.1], [-0.6, -1.1]] as const) parts.push([TRIM, tube([px2, 0.95, pz], [px2 * 0.98, 1.92, pz + (pz > 0 ? 0.04 : 0)], 0.03)])
      parts.push(['#4a3b2f', bx(1.1, 0.16, 0.6, 0, 0.86, -0.65)]) // rear bench
      parts.push(['#4a3b2f', bx(1.1, 0.5, 0.12, 0, 1.12, -0.98)])
      // rolled-up side canvas under the roof edge (runs front to back)
      parts.push(['#2f6e3a', cyl(0.07, 1.9, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(0.68, 1.83, -0.1)])
      parts.push(['#2f6e3a', cyl(0.07, 1.9, 0, 0, 0, 8).rotateX(Math.PI / 2).translate(-0.68, 1.83, -0.1)])
      parts.push(['#f6f1d8', bx(0.24, 0.14, 0.05, 0, 0.9, 1.34)])
      parts.push(...wheel(0.27, 0.16, 0, 0.27, 1.12))
      parts.push(...wheel(0.29, 0.18, 0.62, 0.29, -0.82))
      parts.push(...wheel(0.29, 0.18, -0.62, 0.29, -0.82))
      rider = [...seated(0, 0.95, 0.35, '#2e7d5b'), ...seated(-0.3, 1.08, -0.65, '#b8433a')]
      meta = { radius: 1.25, maxSpeed: 22, accel: 9, cockpit: [0.35, 1.5], seat: [0, 0.95, 0.35], straddle: false, passengers: [[-0.3, 0.94, -0.65], [0.3, 0.94, -0.65]], label: 'Keke NAPEP' }
      break
    }
    case 'okada': {
      // Bajaj-style 125 cc: tank, long seat, carrier, chrome exhaust
      parts.push(...bikeWheel(0.31, 0.68))
      parts.push(...bikeWheel(0.31, -0.68))
      parts.push(['#b8bcc4', tube([0, 0.31, 0.68], [0, 1.02, 0.5], 0.035)]) // fork
      parts.push(['#b8bcc4', tube([0.08, 0.31, 0.68], [0.08, 1.0, 0.5], 0.03)])
      parts.push(['#a3262e', sph(0.2, 0, 0.86, 0.22, 0.85, 0.7, 1.4)]) // tank
      parts.push(['#141416', bx(0.26, 0.1, 0.78, 0, 0.88, -0.32)]) // seat
      parts.push(['#a3262e', bx(0.22, 0.2, 0.4, 0, 0.72, -0.58)]) // tail
      parts.push(['#5a5e64', bx(0.22, 0.3, 0.34, 0, 0.5, 0.02)]) // engine
      parts.push(['#c8ccd2', tube([0.14, 0.42, 0.0], [0.16, 0.48, -0.75], 0.045)]) // exhaust
      parts.push(['#2a2d33', tube([0, 0.5, 0.0], [0, 0.31, -0.68], 0.03)]) // swingarm
      parts.push(['#2a2d33', tube([-0.32, 1.06, 0.48], [0.32, 1.06, 0.48], 0.018)]) // bars
      parts.push(['#f6f1d8', sph(0.08, 0, 0.98, 0.6, 1, 1, 0.6)]) // lamp
      parts.push(['#3a3f46', bx(0.3, 0.03, 0.34, 0, 0.94, -0.85)]) // carrier
      rider = seated(0, 0.92, -0.18, '#3f7d5b', true)
      meta = { radius: 0.95, maxSpeed: 30, accel: 14, cockpit: [0.25, 1.62], seat: [0, 0.92, -0.18], straddle: true, passengers: [[0, 1.0, -0.62]], label: 'Okada' }
      break
    }
    case 'bicycle': {
      const fr = '#2f7d5b'
      parts.push(...bikeWheel(0.34, 0.58))
      parts.push(...bikeWheel(0.34, -0.5))
      const bb: [number, number, number] = [0, 0.3, 0.02] // bottom bracket
      const st: [number, number, number] = [0, 0.86, -0.12] // seat tube top
      const ht: [number, number, number] = [0, 0.9, 0.48] // head tube
      parts.push([fr, tube(bb, st, 0.02)])
      parts.push([fr, tube(bb, ht, 0.022)])
      parts.push([fr, tube(st, ht, 0.02)])
      parts.push([fr, tube(bb, [0, 0.34, -0.5], 0.014)])
      parts.push([fr, tube(st, [0, 0.34, -0.5], 0.014)])
      parts.push(['#b8bcc4', tube(ht, [0, 0.34, 0.58], 0.016)])
      parts.push(['#141416', bx(0.14, 0.05, 0.26, 0, 0.92, -0.14)]) // saddle
      parts.push(['#2a2d33', tube([-0.26, 1.02, 0.45], [0.26, 1.02, 0.45], 0.014)])
      parts.push(['#2a2d33', tube(ht, [0, 1.02, 0.45], 0.016)])
      parts.push(['#c8ccd2', cyl(0.09, 0.02, 0.05, 0.3, 0.02, 12).rotateZ(Math.PI / 2)])
      rider = seated(0, 0.94, -0.22, '#b8433a', true)
      meta = { radius: 0.7, maxSpeed: 11, accel: 6, cockpit: [0.3, 1.6], seat: [0, 0.94, -0.22], straddle: true, passengers: [], label: 'Bicycle' }
      break
    }
    case 'truck': {
      // lorry: cab-over with a wooden tipper body
      const W = 2.3
      parts.push(['#2f5ea8', profile([[0.9, 0.55], [0.9, 2.55], [1.05, 2.65], [2.6, 2.6], [2.85, 2.1], [2.95, 1.0], [2.95, 0.55]], W, 0.06)])
      parts.push([GLASS, profile([[1.25, 1.65], [1.25, 2.4], [2.55, 2.38], [2.78, 1.95], [2.83, 1.65]], W + 0.02, 0.02)])
      parts.push(['#e8e8e0', bx(W - 0.3, 0.3, 0.1, 0, 0.95, 2.98)]) // grille
      parts.push([TRIM, bx(W + 0.1, 0.3, 0.25, 0, 0.6, 2.98)])
      parts.push(['#3a3f46', bx(W - 0.1, 0.25, 5.6, 0, 0.75, -1.2)]) // chassis
      parts.push(['#8a5a34', bx(W, 1.3, 3.9, 0, 1.55, -1.95)]) // wooden body
      parts.push(['#6b4528', bx(W + 0.04, 0.06, 3.92, 0, 1.9, -1.95)])
      parts.push(['#6b4528', bx(W + 0.04, 0.06, 3.92, 0, 1.4, -1.95)])
      parts.push(['#c9a76a', bx(W - 0.3, 0.5, 3.4, 0, 2.3, -1.95)]) // sand load
      parts.push(...lights(2.98, -3.92, 0.9, W / 2))
      for (const z of [2.05, -1.2, -2.6]) for (const s of [-1, 1]) parts.push(...wheel(0.48, 0.34, s * 0.98, 0.48, z))
      door = {
        geo: build([['#2f5ea8', bx(0.05, 1.1, 1.0, 0, -0.1, -0.5)], [GLASS, bx(0.04, 0.6, 0.8, 0.01, 0.62, -0.45)]]),
        hinge: [W / 2 + 0.03, 1.5, 2.35],
        type: 'swing'
      }
      rider = seated(0.55, 1.4, 1.75, '#e8e2d2')
      meta = { radius: 2.4, maxSpeed: 19, accel: 7, cockpit: [2.2, 2.25], seat: [0.55, 1.4, 1.75], straddle: false, passengers: [[-0.55, 1.4, 1.75]], label: 'Lorry' }
      break
    }
    case 'boat': {
      parts = [
        ['#e8e4d8', bx(1.9, 0.65, 4.4, 0, 0.42, -0.2)],
        ['#c9764a', new THREE.ConeGeometry(0.95, 1.6, 4).rotateX(Math.PI / 2).translate(0, 0.42, 2.7)],
        ['#6b4a2f', bx(1.6, 0.14, 3.4, 0, 0.78, -0.4)],
        ['#22262c', bx(0.9, 0.7, 0.3, 0, 1.15, 0.6)],
        ['#8a8f96', new THREE.TorusGeometry(0.26, 0.05, 6, 12).translate(0, 1.42, 0.62)],
        ['#c9764a', bx(1.3, 0.14, 1.0, 0, 0.86, -1.3)]
      ]
      rider = seated(0, 0.95, 0.1, '#3f6fae')
      meta = { radius: 1.6, maxSpeed: 20, accel: 8, cockpit: [0.4, 1.75], seat: [0, 0.95, 0.1], straddle: false, passengers: [[-0.4, 0.95, -0.7], [0.4, 0.95, -0.7]], label: 'River Boat' }
      break
    }
    case 'plane':
    default: {
      parts = [
        ['#e8e4d8', new THREE.CylinderGeometry(0.72, 0.5, 5.6, 14).rotateX(Math.PI / 2).translate(0, 1.05, 0)],
        ['#e8e4d8', new THREE.ConeGeometry(0.5, 1.4, 14).rotateX(Math.PI / 2).translate(0, 1.05, 3.4)],
        ['#b8433a', bx(9.2, 0.16, 1.5, 0, 1.32, 0.4)],
        ['#b8433a', bx(3.0, 0.12, 0.9, 0, 1.55, -2.5)],
        ['#b8433a', bx(0.14, 1.25, 1.0, 0, 1.75, -2.55)],
        [GLASS, bx(1.05, 0.55, 1.15, 0, 1.55, 1.3)],
        ...wheel(0.26, 0.12, -0.9, 0.26, 0.5),
        ...wheel(0.26, 0.12, 0.9, 0.26, 0.5),
        ...wheel(0.2, 0.1, 0, 0.2, -2.4),
        ['#8a8f96', bx(0.16, 0.9, 0.16, 0, 1.05, 4.15)],
        ['#3a3f4a', bx(0.12, 2.1, 0.06, 0, 1.05, 4.2)]
      ]
      rider = seated(-0.3, 1.1, 1.15, '#3f6fae')
      meta = { radius: 2.6, maxSpeed: 38, accel: 7, cockpit: [1.1, 1.75], seat: [-0.3, 1.1, 1.15], straddle: false, passengers: [[0.3, 1.1, 1.15], [-0.3, 1.1, 0.2], [0.3, 1.1, 0.2]], label: 'Light Aircraft' }
      break
    }
  }
  const geo = build([...parts.map(([c, g]) => [c, g.clone()] as Part)])
  const geoRider = build([...parts, ...rider])
  const spec: VehicleSpec = { geo, geoRider, door, ...meta }
  cache.set(key, spec)
  return spec
}

/** Seated driver figure (hips at origin, facing +Z toward the wheel). */
export function buildDriverFigure(): THREE.BufferGeometry {
  // seated adult at the same proportions as CharacterAvatar (head = 1/7.5
  // of the body), origin at the seat
  const torso = new THREE.CylinderGeometry(0.18, 0.16, 0.52, 12)
  torso.scale(1, 1, 0.66)
  torso.translate(0, 0.3, 0)
  const head = new THREE.SphereGeometry(0.112, 14, 10)
  head.scale(0.9, 1.08, 1)
  head.translate(0, 0.76, 0.01)
  const neck = new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8).translate(0, 0.62, 0)
  const kufi = new THREE.CylinderGeometry(0.104, 0.112, 0.085, 14).translate(0, 0.85, 0)
  const thigh = (x: number) => new THREE.CapsuleGeometry(0.075, 0.34, 3, 8).rotateX(Math.PI / 2).translate(x, 0.0, 0.24)
  const shin = (x: number) => new THREE.CapsuleGeometry(0.06, 0.32, 3, 8).translate(x, -0.24, 0.46)
  const arm = (x: number) => new THREE.CapsuleGeometry(0.05, 0.4, 3, 8).rotateX(1.15).translate(x, 0.36, 0.26)
  const hand = (x: number) => new THREE.SphereGeometry(0.045, 8, 6).translate(x, 0.27, 0.5)
  return build([
    ['#2e7d5b', torso],
    ['#2e7d5b', new THREE.SphereGeometry(0.18, 12, 8).scale(1.05, 0.42, 0.68).translate(0, 0.54, 0)],
    ['#7a4e33', head],
    ['#7a4e33', neck],
    ['#f1ece0', kufi],
    ['#2b3440', thigh(-0.1)],
    ['#2b3440', thigh(0.1)],
    ['#2b3440', shin(-0.1)],
    ['#2b3440', shin(0.1)],
    ['#2e7d5b', arm(-0.22)],
    ['#2e7d5b', arm(0.22)],
    ['#7a4e33', hand(-0.22)],
    ['#7a4e33', hand(0.22)]
  ])
}

/** Interior rigs: rendered around the driver while in cockpit view. */
export function buildInterior(kind: VehicleKind): THREE.BufferGeometry | null {
  const parts: Array<[string, THREE.BufferGeometry]> = []
  switch (kind) {
    case 'car':
      parts.push(
        ['#26282e', bx(1.7, 0.32, 0.5, 0, 0.92, 0.95)], // dashboard
        ['#3a3f46', new THREE.TorusGeometry(0.2, 0.04, 6, 14).rotateX(-0.35).translate(0.42, 1.0, 0.62)], // steering wheel (LHD)
        ['#2b2e34', bx(0.5, 0.45, 0.55, -0.42, 0.42, 0.0)], // passenger seat
        ['#2b2e34', bx(1.5, 0.45, 0.55, 0, 0.42, -0.95)], // rear bench
        ['#b8a888', bx(1.6, 0.06, 1.6, 0, 1.44, -0.1)], // headliner
        ['#26282e', bx(0.2, 0.25, 0.6, 0, 0.55, 0.35)] // console
      )
      break
    case 'keke':
      parts.push(
        ['#26282e', bx(1.2, 0.4, 0.3, 0, 1.05, 1.35)],
        ['#3a3f46', new THREE.TorusGeometry(0.2, 0.04, 6, 12).translate(-0.35, 1.2, 1.1)],
        ['#4a3b2f', bx(1.1, 0.4, 0.7, 0, 0.75, -0.6)] // bench
      )
      break
    case 'okada':
      parts.push(
        ['#22262c', bx(0.66, 0.06, 0.06, 0, 1.04, 0.62)], // bars under the hands
        ['#8a8f96', new THREE.TorusGeometry(0.1, 0.03, 5, 10).translate(0, 1.0, 0.5)] // mirror stem
      )
      break
    case 'bus':
      for (let r = 0; r < 3; r++) {
        parts.push(['#2b2e34', bx(1.7, 0.4, 0.5, 0, 0.75, 0.6 - r * 1.5)])
        parts.push(['#2b2e34', bx(1.7, 0.4, 0.5, 0, 1.1, 0.95 - r * 1.5)])
      }
      parts.push(
        ['#26282e', bx(1.9, 0.55, 0.5, 0, 1.3, 2.2)],
        ['#3a3f46', new THREE.TorusGeometry(0.26, 0.05, 6, 14).translate(-0.6, 1.55, 1.85)]
      )
      break
    case 'truck':
      parts.push(
        ['#26282e', bx(1.9, 0.55, 0.4, 0, 1.55, 2.15)],
        ['#3a3f46', new THREE.TorusGeometry(0.28, 0.05, 6, 14).translate(-0.55, 1.75, 1.8)]
      )
      break
    case 'bicycle':
      parts.push(['#3a3f46', new THREE.TorusGeometry(0.22, 0.04, 5, 12).translate(0, 1.1, 0.6)])
      break
    case 'boat':
      parts.push(
        ['#26282e', bx(0.9, 0.75, 0.28, 0, 1.18, 0.6)],
        ['#8a8f96', new THREE.TorusGeometry(0.28, 0.05, 6, 14).translate(0, 1.5, 0.6)],
        ['#4a3b2f', bx(1.4, 0.12, 0.9, 0, 0.9, -1.3)]
      )
      break
    case 'plane':
      parts.push(
        ['#26282e', bx(1.5, 0.55, 0.4, 0, 1.35, 1.6)], // panel
        ['#3a3f46', new THREE.TorusGeometry(0.2, 0.04, 5, 12).rotateX(0.5).translate(0, 1.45, 1.35)], // yoke
        ['#2b2e34', bx(0.5, 0.5, 0.5, 0.62, 0.85, 1.1)], // co-pilot seat
        ['#2b2e34', bx(0.5, 0.5, 0.55, -0.62, 0.85, 1.1)]
      )
      break
  }
  if (!parts.length) return null
  return build(parts)
}


/** A boardable-looking vehicle (body + opening door) painted one colour:
 *  paint panels take the colour, glass / tyres / chrome keep theirs. Used
 *  for owned cars and for other players' vehicles. */
export function paintedVehicle(kind: VehicleKind, color?: string, mat: THREE.Material = vehicleMaterial(), lod: VehicleLod = 'hi'): { group: THREE.Group; door: THREE.Group | null } {
  const spec = vehicleSpec(kind, lod)
  const c = new THREE.Color(color ?? '#3f6fae')
  const geo = spec.geo.clone()
  if (color) {
    const base = spec.geo.attributes.color!.array as Float32Array
    const gloss = spec.geo.attributes.aGloss?.array as Float32Array | undefined
    const arr = new Float32Array(base.length)
    for (let i = 0; i < base.length / 3; i++) {
      const paint = !gloss || Math.abs(gloss[i]! - 0.7) <= 0.01
      arr[i * 3] = base[i * 3]! * (paint ? c.r : 1)
      arr[i * 3 + 1] = base[i * 3 + 1]! * (paint ? c.g : 1)
      arr[i * 3 + 2] = base[i * 3 + 2]! * (paint ? c.b : 1)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  }
  const group = new THREE.Group()
  group.add(bodyWithGlass(geo, mat))
  let door: THREE.Group | null = null
  if (spec.door) {
    const dg = spec.door.geo.clone()
    if (color) {
      const a = dg.attributes.color!.array as Float32Array
      for (let i = 0; i < a.length; i += 3) {
        if (a[i]! > 0.9 && a[i + 1]! > 0.9 && a[i + 2]! > 0.9) {
          a[i] = a[i]! * c.r
          a[i + 1] = a[i + 1]! * c.g
          a[i + 2] = a[i + 2]! * c.b
        }
      }
    }
    door = new THREE.Group()
    door.position.set(...spec.door.hinge)
    door.add(bodyWithGlass(dg, mat))
    group.add(door)
  }
  return { group, door }
}

/** A number plate / owner tag sprite ("KD123 ABC" over the owner's name). */
export function plateSprite(plate: string, owner: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 112
  const g = c.getContext('2d')!
  g.fillStyle = '#f4f4ee'
  g.beginPath()
  g.roundRect(4, 4, 248, 64, 10)
  g.fill()
  g.strokeStyle = '#1f6f4a'
  g.lineWidth = 5
  g.stroke()
  g.fillStyle = '#1f6f4a'
  g.font = '700 14px sans-serif'
  g.textAlign = 'center'
  g.fillText('KADUNA · CENTRE OF LEARNING', 128, 22)
  g.fillStyle = '#16181c'
  g.font = '800 34px sans-serif'
  g.fillText(plate, 128, 58)
  g.fillStyle = 'rgba(20,24,28,0.75)'
  g.beginPath()
  g.roundRect(28, 76, 200, 32, 16)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = '700 18px sans-serif'
  g.fillText(owner, 128, 98)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  s.scale.set(1.6, 0.7, 1)
  return s
}


/** Split off the glass so it can be drawn see-through: you can see the
 *  driver and passengers through the windows. Returns the body (glass
 *  removed) and the glass triangles; the body keeps every other colour. */
export function splitGlass(src: THREE.BufferGeometry): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry | null } {
  const g = src.index ? src.toNonIndexed() : src
  const gl = g.attributes.aGloss as THREE.BufferAttribute | undefined
  if (!gl) return { body: src, glass: null }
  const bodyIdx: number[] = []
  const glassIdx: number[] = []
  const n = g.attributes.position!.count
  for (let t = 0; t + 2 < n; t += 3) {
    const isGlass = gl.getX(t) > 0.95 && gl.getX(t + 1) > 0.95 && gl.getX(t + 2) > 0.95
    ;(isGlass ? glassIdx : bodyIdx).push(t, t + 1, t + 2)
  }
  if (!glassIdx.length) return { body: src, glass: null }
  const body = g.clone()
  body.setIndex(bodyIdx)
  const glass = g.clone()
  glass.setIndex(glassIdx)
  return { body, glass }
}
let _glassMat: THREE.MeshStandardMaterial | null = null
export function glassMaterial(): THREE.MeshStandardMaterial {
  return (_glassMat ??= new THREE.MeshStandardMaterial({ color: '#a9cfdf', transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.3, depthWrite: false }))
}
/** body mesh + see-through glass mesh, grouped */
export function bodyWithGlass(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Group {
  const { body, glass } = splitGlass(geo)
  const g = new THREE.Group()
  const bm = new THREE.Mesh(body, mat)
  bm.castShadow = true
  g.add(bm)
  if (glass) {
    const gm = new THREE.Mesh(glass, glassMaterial())
    gm.renderOrder = 2
    g.add(gm)
  }
  return g
}
