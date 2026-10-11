// Vehicle geometry factory: one merged, vertex-colored BufferGeometry per
// vehicle class, facing +Z. Shared by TrafficSystem (instanced ambient
// traffic) and RideSystem (the boardable vehicles + interior rigs).
import * as THREE from 'three'

export type VehicleKind = 'car' | 'keke' | 'okada' | 'bus' | 'truck' | 'bicycle' | 'boat' | 'plane'

export interface VehicleSpec {
  geo: THREE.BufferGeometry
  /** collision radius in units */
  radius: number
  maxSpeed: number
  accel: number
  /** cockpit eye: [forward, up] offsets from vehicle center */
  cockpit: [number, number]
  /** driver seat for the seated avatar: [lateral, up, forward] */
  seat: [number, number, number]
  label: string
}

function build(parts: Array<[string, THREE.BufferGeometry]>): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []
  const colors: number[] = []
  const col = new THREE.Color()
  for (const [hex, g] of parts) {
    const gg = g.index ? g.toNonIndexed() : g
    if (gg !== g) g.dispose()
    gg.deleteAttribute('uv')
    col.set(hex)
    const n = gg.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r
      arr[i * 3 + 1] = col.g
      arr[i * 3 + 2] = col.b
    }
    gg.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    geos.push(gg)
    for (let i = 0; i < n; i++) colors.push(1, 1, 1)
  }
  // manual merge (positions only + color)
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const pos = new Float32Array(total * 3)
  const ver = new Float32Array(total * 3)
  let off = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, off)
    ver.set(g.attributes.color.array as Float32Array, off)
    off += g.attributes.position.count * 3
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('color', new THREE.BufferAttribute(ver, 3))
  out.computeVertexNormals()
  return out
}

const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}
const wheel = (r: number, w: number, x: number, y: number, z: number) => {
  const g = new THREE.CylinderGeometry(r, r, w, 10)
  g.rotateZ(Math.PI / 2)
  g.translate(x, y, z)
  return g
}

const cache = new Map<VehicleKind, VehicleSpec>()

export function vehicleSpec(kind: VehicleKind): VehicleSpec {
  const hit = cache.get(kind)
  if (hit) return hit
  let spec: VehicleSpec
  switch (kind) {
    case 'car': {
      const white = '#ffffff'
      spec = {
        geo: build([
          [white, bx(1.9, 0.72, 4.3, 0, 0.74, 0)], // body (tinted per instance)
          ['#22262c', bx(1.68, 0.6, 2.15, 0, 1.38, -0.12)], // glasshouse
          ['#e8e4d8', bx(1.7, 0.1, 0.5, 0, 1.36, 1.0)], // roof front edge
          ['#1a1a1e', wheel(0.36, 0.26, -0.92, 0.36, 1.35)],
          ['#1a1a1e', wheel(0.36, 0.26, 0.92, 0.36, 1.35)],
          ['#1a1a1e', wheel(0.36, 0.26, -0.92, 0.36, -1.35)],
          ['#1a1a1e', wheel(0.36, 0.26, 0.92, 0.36, -1.35)],
          ['#f5e9b0', bx(0.42, 0.16, 0.06, -0.6, 0.78, 2.16)], // headlights
          ['#f5e9b0', bx(0.42, 0.16, 0.06, 0.6, 0.78, 2.16)],
          ['#8a2a2a', bx(0.4, 0.14, 0.05, -0.6, 0.8, -2.16)], // tail lights
          ['#8a2a2a', bx(0.4, 0.14, 0.05, 0.6, 0.8, -2.16)]
        ]),
        radius: 1.7,
        maxSpeed: 34,
        accel: 13,
        cockpit: [0.35, 1.45],
        seat: [-0.45, 0.62, 0.35],
        label: 'Car'
      }
      break
    }
    case 'keke': {
      spec = {
        geo: build([
          ['#e6b93c', bx(1.5, 1.0, 2.3, 0, 0.92, -0.1)], // cabin
          ['#e6b93c', bx(1.3, 0.55, 1.0, 0, 0.85, 1.15)], // nose cowl
          ['#22262c', bx(1.2, 0.55, 0.06, 0, 1.28, 1.62)], // windshield
          ['#3a2f1c', bx(1.4, 0.16, 1.7, 0, 1.5, -0.2)], // roof
          ['#1a1a1e', wheel(0.3, 0.18, 0, 0.3, 1.42)], // front wheel
          ['#1a1a1e', wheel(0.34, 0.2, -0.72, 0.34, -0.85)],
          ['#1a1a1e', wheel(0.34, 0.2, 0.72, 0.34, -0.85)],
          ['#c8a12e', bx(0.24, 0.1, 0.05, -0.34, 0.78, 1.66)] // lamp
        ]),
        radius: 1.25,
        maxSpeed: 22,
        accel: 9,
        cockpit: [0.2, 1.3],
        seat: [-0.4, 0.75, 0.15],
        label: 'Keke NAPEP'
      }
      break
    }
    case 'okada': {
      spec = {
        geo: build([
          ['#b8433a', bx(0.34, 0.3, 1.55, 0, 0.66, 0)], // frame
          ['#22262c', bx(0.4, 0.15, 0.72, 0, 0.86, -0.3)], // seat
          ['#22262c', bx(0.78, 0.07, 0.07, 0, 1.04, 0.62)], // handlebar
          ['#1a1a1e', wheel(0.42, 0.12, 0, 0.42, 0.78)],
          ['#1a1a1e', wheel(0.42, 0.12, 0, 0.42, -0.78)],
          ['#3f7d5b', bx(0.44, 0.62, 0.3, 0, 1.28, -0.28)], // rider torso
          ['#8a5a3b', new THREE.SphereGeometry(0.19, 8, 7).translate(0, 1.74, -0.28)], // rider head
          ['#2b3440', bx(0.4, 0.4, 0.24, 0, 0.78, -0.62)] // rider legs
        ]),
        radius: 0.95,
        maxSpeed: 30,
        accel: 14,
        cockpit: [0.25, 1.55],
        seat: [0, 0.95, -0.45],
        label: 'Okada'
      }
      break
    }
    case 'bus': {
      spec = {
        geo: build([
          ['#d8c23c', bx(2.1, 1.6, 5.0, 0, 1.18, 0)], // danfo body
          ['#22262c', bx(2.16, 0.55, 3.9, 0, 1.62, -0.15)], // window band
          ['#2b2f36', bx(2.14, 0.3, 5.02, 0, 0.78, 0)], // skirt stripe
          ['#1a1a1e', wheel(0.42, 0.26, -1.0, 0.42, 1.65)],
          ['#1a1a1e', wheel(0.42, 0.26, 1.0, 0.42, 1.65)],
          ['#1a1a1e', wheel(0.42, 0.26, -1.0, 0.42, -1.6)],
          ['#1a1a1e', wheel(0.42, 0.26, 1.0, 0.42, -1.6)],
          ['#f5e9b0', bx(0.5, 0.18, 0.06, -0.66, 1.0, 2.51)],
          ['#f5e9b0', bx(0.5, 0.18, 0.06, 0.66, 1.0, 2.51)]
        ]),
        radius: 2.3,
        maxSpeed: 24,
        accel: 9,
        cockpit: [0.4, 1.58],
        seat: [-0.55, 1.1, 1.55],
        label: 'Danfo Bus'
      }
      break
    }
    case 'truck': {
      spec = {
        geo: build([
          ['#3f6fae', bx(2.0, 1.35, 1.9, 0, 1.35, 1.55)], // cab
          ['#dfe3ea', bx(2.24, 1.85, 3.4, 0, 1.5, -0.85)], // cargo box
          ['#22262c', bx(1.9, 0.5, 0.08, 0, 1.5, 2.52)], // windshield
          ['#1a1a1e', wheel(0.46, 0.3, -0.98, 0.46, 1.7)],
          ['#1a1a1e', wheel(0.46, 0.3, 0.98, 0.46, 1.7)],
          ['#1a1a1e', wheel(0.46, 0.3, -0.98, 0.46, -1.5)],
          ['#1a1a1e', wheel(0.46, 0.3, 0.98, 0.46, -1.5)]
        ]),
        radius: 2.3,
        maxSpeed: 19,
        accel: 7,
        cockpit: [0.4, 1.5],
        seat: [-0.5, 1.3, 1.5],
        label: 'Lorry'
      }
      break
    }
    case 'bicycle': {
      spec = {
        geo: build([
          ['#3a7d5b', bx(0.08, 0.08, 1.5, 0, 0.62, 0)], // frame spar
          ['#3a7d5b', bx(0.08, 0.5, 0.08, 0, 0.85, 0.55)], // fork
          ['#22262c', bx(0.6, 0.06, 0.06, 0, 1.1, 0.6)], // handlebar
          ['#22262c', bx(0.34, 0.1, 0.4, 0, 0.95, -0.25)], // saddle
          ['#1a1a1e', wheel(0.34, 0.05, 0, 0.34, 0.72)],
          ['#1a1a1e', wheel(0.34, 0.05, 0, 0.34, -0.72)],
          ['#8a5a3b', new THREE.SphereGeometry(0.18, 8, 7).translate(0, 1.68, -0.2)], // rider head
          ['#b8433a', bx(0.4, 0.55, 0.26, 0, 1.28, -0.2)], // rider torso
          ['#2b3440', bx(0.36, 0.4, 0.22, 0, 0.82, -0.5)] // rider legs
        ]),
        radius: 0.7,
        maxSpeed: 11,
        accel: 6,
        cockpit: [0.3, 1.5],
        seat: [0, 1.0, -0.25],
        label: 'Bicycle'
      }
      break
    }
    case 'boat': {
      spec = {
        geo: build([
          ['#e8e4d8', bx(1.9, 0.65, 4.4, 0, 0.42, -0.2)], // hull
          ['#c9764a', new THREE.ConeGeometry(0.95, 1.6, 4).rotateX(Math.PI / 2).translate(0, 0.42, 2.7)], // bow
          ['#6b4a2f', bx(1.6, 0.14, 3.4, 0, 0.78, -0.4)], // deck trim
          ['#22262c', bx(0.9, 0.7, 0.3, 0, 1.15, 0.6)], // console
          ['#8a8f96', new THREE.TorusGeometry(0.26, 0.05, 6, 12).translate(0, 1.42, 0.62)], // wheel
          ['#c9764a', bx(1.3, 0.14, 1.0, 0, 0.86, -1.3)] // stern bench
        ]),
        radius: 1.6,
        maxSpeed: 20,
        accel: 8,
        cockpit: [0.4, 1.75],
        seat: [0, 0.95, 0.6],
        label: 'River Boat'
      }
      break
    }
    case 'plane': {
      spec = {
        geo: build([
          ['#e8e4d8', (() => {
            const g = new THREE.CylinderGeometry(0.72, 0.5, 5.6, 10)
            g.rotateX(Math.PI / 2)
            g.translate(0, 1.05, 0)
            return g
          })()],
          ['#e8e4d8', new THREE.ConeGeometry(0.5, 1.4, 10).rotateX(Math.PI / 2).translate(0, 1.05, 3.4)], // nose
          ['#b8433a', bx(9.2, 0.16, 1.5, 0, 1.32, 0.4)], // wing
          ['#b8433a', bx(3.0, 0.12, 0.9, 0, 1.55, -2.5)], // tailplane
          ['#b8433a', bx(0.14, 1.25, 1.0, 0, 1.75, -2.55)], // fin
          ['#22262c', bx(1.05, 0.55, 1.15, 0, 1.55, 1.3)], // canopy
          ['#1a1a1e', wheel(0.26, 0.12, -0.9, 0.26, 0.5)],
          ['#1a1a1e', wheel(0.26, 0.12, 0.9, 0.26, 0.5)],
          ['#1a1a1e', wheel(0.2, 0.1, 0, 0.2, -2.4)],
          ['#8a8f96', bx(0.16, 0.9, 0.16, 0, 1.05, 4.15)], // prop hub
          ['#3a3f4a', bx(0.12, 2.1, 0.06, 0, 1.05, 4.2)] // prop blade
        ]),
        radius: 2.6,
        maxSpeed: 38,
        accel: 7,
        cockpit: [1.1, 1.75],
        seat: [-0.42, 1.15, 1.15],
        label: 'Light Aircraft'
      }
      break
    }
  }
  cache.set(kind, spec)
  return spec
}

/** Seated driver figure (hips at origin, facing +Z toward the wheel). */
export function buildDriverFigure(): THREE.BufferGeometry {
  return build([
    ['#2e7d5b', bx(0.44, 0.62, 0.28, 0, 0.31, 0)], // torso
    ['#8a5a3b', new THREE.SphereGeometry(0.22, 10, 8).translate(0, 0.78, 0)], // head
    ['#e8e2d2', bx(0.3, 0.09, 0.3, 0, 0.94, 0)], // kufi
    ['#2b3440', bx(0.16, 0.14, 0.6, -0.14, -0.12, 0.34)], // left thigh
    ['#2b3440', bx(0.16, 0.14, 0.6, 0.14, -0.12, 0.34)], // right thigh
    ['#2e7d5b', bx(0.12, 0.12, 0.46, -0.27, 0.4, 0.3)], // left arm to wheel
    ['#2e7d5b', bx(0.12, 0.12, 0.46, 0.27, 0.4, 0.3)], // right arm
    ['#8a5a3b', bx(0.09, 0.09, 0.09, -0.27, 0.4, 0.55)], // left hand
    ['#8a5a3b', bx(0.09, 0.09, 0.09, 0.27, 0.4, 0.55)] // right hand
  ])
}

/** Interior rigs: rendered around the driver while in cockpit view. */
export function buildInterior(kind: VehicleKind): THREE.BufferGeometry | null {
  const parts: Array<[string, THREE.BufferGeometry]> = []
  switch (kind) {
    case 'car':
      parts.push(
        ['#26282e', bx(1.8, 0.5, 0.6, 0, 1.02, 1.35)], // dashboard
        ['#3a3f46', new THREE.TorusGeometry(0.24, 0.045, 6, 14).translate(-0.45, 1.18, 1.05)], // wheel
        ['#2b2e34', bx(0.5, 0.45, 0.55, 0.45, 0.62, 0.2)], // passenger seat
        ['#2b2e34', bx(0.5, 0.45, 0.55, -0.45, 0.62, -1.0)], // rear seat L
        ['#2b2e34', bx(0.5, 0.45, 0.55, 0.45, 0.62, -1.0)], // rear seat R
        ['#b8a888', bx(1.7, 0.7, 0.06, 0, 1.5, 2.14)], // windshield header
        ['#26282e', bx(0.34, 0.3, 0.34, 0.5, 1.02, 0.35)] // console box
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
