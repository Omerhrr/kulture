// carBody - a smooth, modern saloon built as lofted surfaces instead of
// boxes: the lower body and the glasshouse are swept through superellipse
// cross-sections whose width/height follow real proportions (long bonnet,
// fast windscreen, fastback roof, short boot), with wheel arches carved by
// raising the sill over each axle. Smooth vertex normals give the paint
// continuous highlights; lamps, grille, diffuser, mirrors, seams, handles
// and 5-spoke alloys are layered on top. Front is +Z, up is +Y.
import * as THREE from 'three'

export type CarPart = [string, THREE.BufferGeometry]

/** Detail level of the car being built: 1 = the full hero car you drive,
 * lower = the same silhouette with far fewer vertices for traffic, parked
 * cars and props seen from a distance. Set by buildSaloon for its duration. */
let D = 1
const seg = (n: number, min = 3) => Math.max(min, Math.round(n * D))

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** piecewise-linear lookup through [z, value] keys (sorted by z) */
function keyed(keys: Array<[number, number]>, z: number): number {
  if (z <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (z <= keys[i][0]) {
      const [z0, v0] = keys[i - 1]
      const [z1, v1] = keys[i]
      const t = (z - z0) / (z1 - z0)
      return lerp(v0, v1, t * t * (3 - 2 * t))
    }
  }
  return keys[keys.length - 1][1]
}

interface Section {
  hw: number // half width
  yb: number // bottom
  yt: number // top
  n: number // superellipse exponent (2 = ellipse, higher = boxier)
  tuck: number // tumblehome: how much the top narrows (0..1)
}

/** Sweep superellipse sections along z, caps at both ends, smooth normals. */
function loft(z0: number, z1: number, stations: number, ring: number, at: (z: number) => Section): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= stations; i++) {
    const z = lerp(z0, z1, i / stations)
    const s = at(z)
    const cy = (s.yb + s.yt) / 2
    const ry = Math.max(0.001, (s.yt - s.yb) / 2)
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const e = 2 / s.n
      let x = Math.sign(c) * Math.pow(Math.abs(c), e) * s.hw
      const y = cy + Math.sign(sn) * Math.pow(Math.abs(sn), e) * ry
      // tumblehome: the upper half leans inwards
      const up = Math.max(0, sn)
      x *= 1 - s.tuck * up * up
      pos.push(x, y, z)
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k
      const b = i * ring + ((k + 1) % ring)
      const c = (i + 1) * ring + k
      const d = (i + 1) * ring + ((k + 1) % ring)
      idx.push(a, b, c, b, d, c)
    }
  }
  // end caps (fans to the section centre)
  for (const [i, flip] of [
    [0, true],
    [stations, false]
  ] as Array<[number, boolean]>) {
    const base = i * ring
    let cx = 0
    let cy = 0
    for (let k = 0; k < ring; k++) {
      cy += pos[(base + k) * 3 + 1]
    }
    cy /= ring
    const ci = pos.length / 3
    pos.push(cx, cy, pos[base * 3 + 2])
    for (let k = 0; k < ring; k++) {
      const a = base + k
      const b = base + ((k + 1) % ring)
      if (flip) idx.push(ci, a, b)
      else idx.push(ci, b, a)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Flattened ellipsoid pressed onto the body surface (lamps, grille). */
function pad(rx: number, ry: number, rz: number, x: number, y: number, z: number, rotY = 0, rotX = 0) {
  const g = new THREE.SphereGeometry(1, seg(18, 6), seg(10, 4))
  g.scale(rx, ry, rz)
  if (rotX) g.rotateX(rotX)
  if (rotY) g.rotateY(rotY)
  g.translate(x, y, z)
  return g
}

/** Tyre with rounded shoulders (lathe) + 5-spoke alloy, axle along X. */
function alloyWheel(r: number, w: number, x: number, y: number, z: number, out: CarPart[], rimHex: string) {
  const side = x >= 0 ? 1 : -1
  const prof: THREE.Vector2[] = []
  const rIn = r * 0.66
  const hw = w / 2
  // sidewall -> shoulder -> tread -> shoulder -> sidewall
  const pts: Array<[number, number]> = [
    [rIn, -hw * 0.9],
    [r * 0.92, -hw],
    [r * 0.99, -hw * 0.82],
    [r, -hw * 0.5],
    [r, hw * 0.5],
    [r * 0.99, hw * 0.82],
    [r * 0.92, hw],
    [rIn, hw * 0.9]
  ]
  for (const [a, b] of pts) prof.push(new THREE.Vector2(a, b))
  const tyre = new THREE.LatheGeometry(prof, seg(28, 10))
  tyre.rotateZ(Math.PI / 2)
  tyre.translate(x, y, z)
  out.push(['#121214', tyre])
  // rim barrel + lip
  const barrel = new THREE.CylinderGeometry(rIn, rIn, w * 0.86, seg(24, 10), 1, true).rotateZ(Math.PI / 2).translate(x, y, z)
  out.push(['#3a3d42', barrel])
  const face = x + side * w * 0.38
  if (D < 1) {
    // distant car: a solid rim face is all that reads
    out.push([rimHex, new THREE.CylinderGeometry(rIn * 0.96, rIn * 0.96, 0.03, seg(24, 10)).rotateZ(Math.PI / 2).translate(face, y, z)])
    return
  }
  const lip = new THREE.TorusGeometry(rIn * 0.98, 0.012, 6, 28).rotateY(Math.PI / 2).translate(x + side * w * 0.43, y, z)
  out.push([rimHex, lip])
  // face: dark dish behind, brake disc, 5 spokes, centre cap
  out.push(['#1c1e22', new THREE.CylinderGeometry(rIn * 0.96, rIn * 0.96, 0.02, 24).rotateZ(Math.PI / 2).translate(face - side * 0.05, y, z)])
  out.push(['#7a7e84', new THREE.CylinderGeometry(rIn * 0.7, rIn * 0.7, 0.025, 20).rotateZ(Math.PI / 2).translate(face - side * 0.09, y, z)])
  out.push(['#8a2a22', new THREE.BoxGeometry(0.06, 0.12, 0.1).translate(face - side * 0.07, y + rIn * 0.55, z - 0.06)]) // caliper
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3
    const sp = new THREE.BoxGeometry(0.03, rIn * 0.86, 0.075)
    sp.translate(0, rIn * 0.47, 0)
    sp.rotateX(a)
    sp.translate(face, y, z)
    out.push([rimHex, sp])
  }
  out.push([rimHex, new THREE.CylinderGeometry(rIn * 0.2, rIn * 0.24, 0.05, 14).rotateZ(Math.PI / 2).translate(face + side * 0.01, y, z)])
}

export interface CarDims {
  W: number
  wheelR: number
  axleF: number
  axleR: number
}
export const CAR_DIMS: CarDims = { W: 1.84, wheelR: 0.34, axleF: 1.42, axleR: -1.4 }

/**
 * Build the saloon. `BODY` is the paint colour (tinted per instance),
 * `GLASS`/`TRIM` the dark glazing and plastics.
 */
export function buildSaloon(BODY: string, GLASS: string, TRIM: string, detail = 1): CarPart[] {
  D = detail
  try {
    return saloon(BODY, GLASS, TRIM)
  } finally {
    D = 1
  }
}

function saloon(BODY: string, GLASS: string, TRIM: string): CarPart[] {
  const out: CarPart[] = []
  const { W, wheelR, axleF, axleR } = CAR_DIMS
  const HW = W / 2
  const L0 = -2.32
  const L1 = 2.34

  // wheel arch: lift the sill in a smooth half-circle over each axle
  const arch = (z: number) => {
    let a = 0
    for (const az of [axleF, axleR]) {
      const d = Math.abs(z - az) / (wheelR + 0.1)
      if (d < 1) a = Math.max(a, Math.sqrt(1 - d * d))
    }
    return a
  }

  // ---- lower body: nose -> bonnet -> doors -> rear deck -> boot
  const body = loft(L0, L1, seg(64, 16), seg(40, 16), (z) => {
    // ends round off in plan and in elevation
    const endF = smooth(L1 - 0.5, L1, z)
    const endR = smooth(L0 + 0.42, L0, z)
    const hw = HW * (1 - 0.22 * endF * endF - 0.16 * endR * endR) * Math.sqrt(1 - Math.pow(Math.max(endF, endR) * 0.92, 4))
    const yt = keyed(
      [
        [L0, 0.82],
        [L0 + 0.25, 0.94],
        [-1.75, 1.0],
        [-1.1, 1.02],
        [0.9, 1.0],
        [1.6, 0.92],
        [2.1, 0.8],
        [L1, 0.62]
      ],
      z
    )
    const ybBase = keyed(
      [
        [L0, 0.42],
        [L0 + 0.35, 0.3],
        [L1 - 0.4, 0.28],
        [L1, 0.36]
      ],
      z
    )
    const yb = lerp(ybBase, wheelR * 2 + 0.06, arch(z) * 0.88)
    return { hw, yb, yt, n: 5.5, tuck: 0.14 }
  })
  out.push([BODY, body])

  // ---- glasshouse: windscreen -> roof -> fastback
  const cabin = loft(-1.42, 1.12, seg(40, 10), seg(32, 12), (z) => {
    const yt = keyed(
      [
        [-1.42, 1.0],
        [-1.0, 1.25],
        [-0.55, 1.42],
        [0.0, 1.46],
        [0.38, 1.44],
        [0.8, 1.22],
        [1.12, 1.0]
      ],
      z
    )
    const endF = smooth(0.95, 1.12, z)
    const endR = smooth(-1.25, -1.42, z)
    const hw = (HW - 0.1) * (1 - 0.1 * Math.max(endF, endR))
    return { hw, yb: 0.9, yt, n: 4, tuck: 0.3 }
  })
  out.push([GLASS, cabin])

  // painted roof panel + pillars over the glass
  const roof = loft(-0.62, 0.34, seg(18, 4), seg(28, 10), (z) => {
    const yt = keyed(
      [
        [-0.62, 1.405],
        [-0.4, 1.448],
        [0.0, 1.47],
        [0.34, 1.448]
      ],
      z
    )
    return { hw: HW - 0.2, yb: yt - 0.07, yt: yt + 0.006, n: 6, tuck: 0.25 }
  })
  out.push([BODY, roof])
  const pillar = (a: [number, number, number], b: [number, number, number], r: number, hex = BODY) => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg(8, 4))
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()))
    const m = va.add(vb).multiplyScalar(0.5)
    g.translate(m.x, m.y, m.z)
    out.push([hex, g])
  }
  for (const s of [-1, 1]) {
    const xs = s * (HW - 0.16)
    pillar([s * (HW - 0.1), 1.0, 1.08], [s * (HW - 0.3), 1.42, 0.36], 0.022, TRIM) // A
    pillar([s * (HW - 0.14), 1.0, -0.12], [s * (HW - 0.29), 1.44, -0.12], 0.03, TRIM) // B
    pillar([s * (HW - 0.12), 1.0, -1.28], [s * (HW - 0.3), 1.4, -0.62], 0.03, TRIM) // C
    // chrome-dark window surround line along the beltline
    pillar([s * (HW - 0.05), 1.005, 1.05], [s * (HW - 0.06), 1.005, -1.32], 0.016, TRIM)
    void xs
  }

  // ---- lamps: slim LED headlights wrapping into the wings
  for (const s of [-1, 1]) {
    out.push(['#e9eef4', pad(0.26, 0.04, 0.08, s * 0.53, 0.77, 2.08, s * -0.32, -0.3)])
    if (D === 1) out.push(['#9fb3c6', pad(0.2, 0.018, 0.07, s * 0.55, 0.735, 2.09, s * -0.32, -0.3)]) // DRL underline
    // tail lights: blade wrapping around the corner
    out.push(['#7a1016', pad(0.26, 0.05, 0.07, s * 0.5, 0.88, -2.16, s * 0.3)])
    out.push(['#d0242e', pad(0.2, 0.02, 0.06, s * 0.52, 0.895, -2.18, s * 0.3)])
    // mirrors on short stalks
    out.push([TRIM, pad(0.06, 0.03, 0.05, s * (HW + 0.03), 1.02, 0.98)])
    out.push([BODY, pad(0.085, 0.055, 0.06, s * (HW + 0.08), 1.06, 0.95)])
    // side skirt + door handles + shut lines
    out.push([TRIM, new THREE.BoxGeometry(0.03, 0.08, 1.5).translate(s * (HW - 0.02), 0.36, 0.0)])
    if (D === 1) {
      for (const hz of [0.28, -0.82]) out.push([TRIM, pad(0.012, 0.02, 0.09, s * (HW - 0.005), 0.86, hz)])
      for (const lz of [0.98, -0.14, -1.22]) out.push(['#3a3c40', new THREE.BoxGeometry(0.01, 0.48, 0.012).translate(s * (HW - 0.003), 0.66, lz)])
    }
    // front fog/air intakes
    out.push(['#0f1012', pad(0.15, 0.05, 0.05, s * 0.56, 0.48, 2.2, s * -0.3)])
  }
  // full-width rear light bar
  out.push(['#5a0c10', new THREE.BoxGeometry(0.62, 0.025, 0.04).translate(0, 0.9, -2.2)])
  // grille + badge
  out.push(['#141518', pad(0.46, 0.09, 0.06, 0, 0.56, 2.24)])
  out.push(['#c8ccd2', pad(0.05, 0.05, 0.02, 0, 0.72, 2.29)])
  out.push(['#c8ccd2', pad(0.045, 0.045, 0.02, 0, 0.86, -2.29)])
  // rear diffuser + number plates
  out.push(['#141518', pad(0.66, 0.08, 0.07, 0, 0.44, -2.2)])
  out.push(['#f0f0ea', new THREE.BoxGeometry(0.5, 0.12, 0.02).translate(0, 0.62, -2.24)])
  out.push(['#f0f0ea', new THREE.BoxGeometry(0.46, 0.11, 0.02).translate(0, 0.42, 2.28)])
  // underbody shadow catcher so you never see daylight through the arches
  out.push(['#0c0c0e', new THREE.BoxGeometry(W - 0.3, 0.06, 3.9).translate(0, 0.3, 0)])

  for (const az of [axleF, axleR]) for (const s of [-1, 1]) alloyWheel(wheelR, 0.25, s * (HW - 0.14), wheelR, az, out, '#c9ccd1')
  return out
}
