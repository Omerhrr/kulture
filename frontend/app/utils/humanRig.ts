// Human rig v3 - a skinned, fully jointed person built in code.
//
// One THREE.Skeleton (41 bones: hips, 3-piece spine, neck, head, collar
// bones, upper/fore arms, hands with two-segment fingers + thumb, thighs,
// shins, feet, toes) drives several SkinnedMeshes that share it: skin,
// top, bottom, shoes, hair, cap, eyes... Every surface is skinned with
// blended weights near the joints, so elbows, knees and shoulders bend
// smoothly instead of hinging. Clothes are real layers: kaftan and gown
// skirts are weighted between the hips and both legs, so the cloth swings
// with each stride.
//
// Rest pose: standing, facing +z, arms hanging, 1.78 m tall. Side s = +1 is
// the +x side, s = -1 the -x side.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface LookSpec {
  outfit: 'kaftan' | 'dress' | 'shirt'
  top: string
  bottom: string
  skin: string
  hair: 'cap' | 'afro' | 'braids' | 'bald'
  hairColor: string
  kufi: boolean
  hijab: boolean
  beard: boolean
  female: boolean
}

export type BoneName = string
export interface HumanRig {
  root: THREE.Group
  bones: Record<BoneName, THREE.Bone>
  rest: Record<BoneName, THREE.Vector3>
  dispose: () => void
}

// ------------------------------------------------------------------ skeleton
const FINGERS = [
  // name, z offset across the palm, length scale
  ['index', 0.03, 1.0],
  ['middle', 0.01, 1.08],
  ['ring', -0.011, 1.0],
  ['pinky', -0.03, 0.82]
] as const

function restPositions(female: boolean): Record<string, [number, number, number]> {
  const w = female ? 0.93 : 1 // shoulder width factor
  const hw = female ? 1.06 : 1 // hip width factor
  const P: Record<string, [number, number, number]> = {
    hips: [0, 0.95, 0],
    spine: [0, 1.08, 0],
    chest: [0, 1.25, 0],
    neck: [0, 1.47, 0],
    head: [0, 1.56, 0]
  }
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R'
    const hx = s * 0.19 * w
    P['clav' + k] = [s * 0.035, 1.42, 0]
    P['upperArm' + k] = [hx, 1.415, -0.012]
    P['foreArm' + k] = [hx + s * 0.012, 1.125, -0.012]
    P['hand' + k] = [hx + s * 0.018, 0.875, 0]
    for (const [f, z, l] of FINGERS) {
      P[f + '1' + k] = [hx + s * 0.02, 0.79, z]
      P[f + '2' + k] = [hx + s * 0.02, 0.79 - 0.042 * l, z]
    }
    P['thumb1' + k] = [hx + s * 0.002, 0.855, 0.036]
    P['thumb2' + k] = [hx - s * 0.006, 0.815, 0.058]
    P['thigh' + k] = [s * 0.095 * hw, 0.92, 0]
    P['shin' + k] = [s * 0.095 * hw, 0.5, 0.005]
    P['foot' + k] = [s * 0.097 * hw, 0.085, -0.012]
    P['toe' + k] = [s * 0.098 * hw, 0.025, 0.12]
  }
  return P
}
const PARENT: Record<string, string | null> = { hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck' }
for (const k of ['L', 'R']) {
  PARENT['clav' + k] = 'chest'
  PARENT['upperArm' + k] = 'clav' + k
  PARENT['foreArm' + k] = 'upperArm' + k
  PARENT['hand' + k] = 'foreArm' + k
  for (const [f] of FINGERS) {
    PARENT[f + '1' + k] = 'hand' + k
    PARENT[f + '2' + k] = f + '1' + k
  }
  PARENT['thumb1' + k] = 'hand' + k
  PARENT['thumb2' + k] = 'thumb1' + k
  PARENT['thigh' + k] = 'hips'
  PARENT['shin' + k] = 'thigh' + k
  PARENT['foot' + k] = 'shin' + k
  PARENT['toe' + k] = 'foot' + k
}

// ------------------------------------------------------------------ skinning helpers
type W = Array<[string, number]>
interface Piece {
  geo: THREE.BufferGeometry
  weights: (p: THREE.Vector3, i: number) => W
}

/** tapered tube from a to b, weighted along its length (blends at both ends) */
function tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, bone: string, parent: string | null, child: string | null, opts: { seg?: number; len?: number; sx?: number; sz?: number; blend?: number; caps?: boolean } = {}): Piece {
  const len = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r1, r0, len, opts.seg ?? 14, opts.len ?? 8, !opts.caps)
  g.translate(0, len / 2, 0)
  g.scale(opts.sx ?? 1, 1, opts.sz ?? 1)
  // remember the along-axis coordinate before orienting
  const pos = g.attributes.position
  const along = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) along[i] = pos.getY(i) / len
  const dir = b.clone().sub(a).normalize()
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
  g.translate(a.x, a.y, a.z)
  const bl = opts.blend ?? 0.22
  return {
    geo: g,
    weights: (_p, i) => {
      const t = along[i]
      const out: W = []
      let wp = 0
      let wc = 0
      if (parent && t < bl) wp = 0.5 * (1 - t / bl)
      if (child && t > 1 - bl) wc = 0.5 * ((t - (1 - bl)) / bl)
      out.push([bone, 1 - wp - wc])
      if (wp > 0) out.push([parent!, wp])
      if (wc > 0) out.push([child!, wc])
      return out
    }
  }
}
function ball(c: THREE.Vector3, r: number, w: W | ((p: THREE.Vector3) => W), sx = 1, sy = 1, sz = 1, seg = 16): Piece {
  const g = new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7)))
  g.scale(sx, sy, sz)
  g.translate(c.x, c.y, c.z)
  return { geo: g, weights: typeof w === 'function' ? (p) => w(p) : () => w }
}
function rigid(g: THREE.BufferGeometry, bone: string): Piece {
  return { geo: g, weights: () => [[bone, 1]] }
}
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
/** torso weights by height: hips -> spine -> chest -> neck */
function spineW(y: number): W {
  const a = sstep(0.98, 1.12, y) // hips->spine
  const b = sstep(1.17, 1.3, y) // spine->chest
  const c = sstep(1.44, 1.5, y) // chest->neck
  const w: W = []
  const hips = 1 - a
  const spine = a * (1 - b)
  const chest = a * b * (1 - c)
  const neck = a * b * c
  if (hips > 0.001) w.push(['hips', hips])
  if (spine > 0.001) w.push(['spine', spine])
  if (chest > 0.001) w.push(['chest', chest])
  if (neck > 0.001) w.push(['neck', neck])
  return w
}
/** lathe (surface of revolution) with an elliptical cross-section */
function lathe(profile: Array<[number, number]>, sz: number, w: (p: THREE.Vector3) => W, seg = 24, sx = 1): Piece {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, seg)
  g.scale(sx, 1, sz)
  return { geo: g, weights: (p) => w(p) }
}
/** skirt: blends hips -> both thighs (by side) -> shins at the hem, so it swings */
function skirtW(top: number, bottom: number, hw: number) {
  return (p: THREE.Vector3): W => {
    const t = Math.min(1, Math.max(0, (top - p.y) / (top - bottom)))
    const side = Math.min(1, Math.max(0, 0.5 + p.x / (hw * 2.2)))
    const legShare = Math.min(0.85, t * 1.05)
    const shinShare = Math.max(0, t - 0.55) * 0.9
    const w: W = [['hips', 1 - legShare]]
    const thigh = legShare - shinShare
    if (thigh > 0) {
      w.push(['thighL', thigh * side])
      w.push(['thighR', thigh * (1 - side)])
    }
    if (shinShare > 0) {
      w.push(['shinL', shinShare * side])
      w.push(['shinR', shinShare * (1 - side)])
    }
    return w
  }
}

function bake(pieces: Piece[], boneIndex: Record<string, number>): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = []
  const v = new THREE.Vector3()
  for (const pc of pieces) {
    const g = pc.geo.index ? pc.geo : pc.geo
    if (g.attributes.uv) g.deleteAttribute('uv')
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()])
    const n = g.attributes.position.count
    const si = new Uint16Array(n * 4)
    const sw = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i)
      const w = pc.weights(v, i)
        .filter(([, x]) => x > 1e-4)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
      const tot = w.reduce((s, [, x]) => s + x, 0) || 1
      for (let j = 0; j < w.length; j++) {
        si[i * 4 + j] = boneIndex[w[j][0]] ?? 0
        sw[i * 4 + j] = w[j][1] / tot
      }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
    geos.push(g)
  }
  if (!geos.length) return null
  const merged = mergeGeometries(geos, false)
  merged?.computeBoundingSphere()
  return merged
}

// ------------------------------------------------------------------ builder
export function buildHuman(look: LookSpec): HumanRig {
  const P = restPositions(look.female)
  const V = (k: string) => new THREE.Vector3(...P[k])
  const root = new THREE.Group()

  // bones (positions are local to the parent)
  const bones: Record<string, THREE.Bone> = {}
  const list: THREE.Bone[] = []
  for (const name of Object.keys(PARENT)) {
    const b = new THREE.Bone()
    b.name = name
    bones[name] = b
    list.push(b)
  }
  for (const [name, parent] of Object.entries(PARENT)) {
    const b = bones[name]
    const p = V(name)
    if (parent) {
      p.sub(V(parent))
      bones[parent].add(b)
    } else root.add(b)
    b.position.copy(p)
  }
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(list)
  const boneIndex: Record<string, number> = {}
  list.forEach((b, i) => (boneIndex[b.name] = i))
  const rest: Record<string, THREE.Vector3> = {}
  for (const n of Object.keys(bones)) rest[n] = bones[n].position.clone()

  const female = look.female
  const outfit = look.outfit
  const hw = female ? 0.18 : 0.165
  const groups: Record<string, Piece[]> = { skin: [], top: [], bottom: [], shoe: [], sole: [], hair: [], cap: [], trim: [], eye: [], iris: [], lip: [], brow: [] }

  // ---- torso (the top garment IS the torso surface: no hidden skin)
  const chestR = female ? 0.165 : 0.185
  const torsoProfile: Array<[number, number]> = [
    [0.001, 0.86],
    [hw * 0.82, 0.87],
    [hw, 0.94],
    [hw * 0.97, 1.02],
    [female ? 0.135 : 0.15, 1.1],
    [chestR * 0.96, 1.22],
    [chestR, 1.32],
    [chestR * 1.02, 1.39],
    [0.15, 1.44],
    [0.075, 1.47],
    [0.001, 1.475]
  ]
  const torsoSz = female ? 0.66 : 0.6
  const torso = lathe(torsoProfile, torsoSz, (p) => spineW(p.y), 28)
  if (outfit === 'shirt') {
    // shirt on top, trousers below the belt line
    const shirtPart = lathe(torsoProfile.filter(([, y]) => y >= 0.99).map(([r, y], i) => (i === 0 ? [r * 1.02, 0.99] : [r, y])) as Array<[number, number]>, torsoSz, (p) => spineW(p.y), 28)
    groups.top.push(shirtPart)
    groups.bottom.push(lathe([[0.001, 0.86], [hw * 0.82, 0.87], [hw * 1.01, 0.94], [hw * 0.99, 1.0], [0.001, 1.0]], torsoSz, (p) => spineW(p.y), 28))
    groups.bottom.push(lathe([[hw * 1.0, 0.985], [hw * 1.03, 0.995], [hw * 1.03, 1.02], [hw * 1.0, 1.03]], torsoSz, (p) => spineW(p.y), 28)) // belt
    // collar + placket
    groups.trim.push(rigid(new THREE.TorusGeometry(0.068, 0.013, 6, 18, Math.PI * 1.2).rotateX(Math.PI / 2).rotateY(Math.PI * 0.4).translate(0, 1.455, 0.012), 'chest'))
  } else groups.top.push(torso)
  if (outfit === 'kaftan') {
    // embroidered neckline
    groups.trim.push(rigid(new THREE.TorusGeometry(0.07, 0.01, 6, 20).rotateX(Math.PI / 2 - 0.25).translate(0, 1.455, 0.025), 'chest'))
    groups.trim.push(rigid(new THREE.BoxGeometry(0.022, 0.2, 0.01).translate(0, 1.33, 0.112), 'chest'))
  }

  // ---- skirts: kaftan to the knee, gown to the ankle (cloth that swings)
  if (outfit === 'kaftan' || outfit === 'dress') {
    const top = 1.0
    const bottom = outfit === 'kaftan' ? 0.48 : 0.1
    const rb = outfit === 'kaftan' ? 0.27 : 0.36
    const prof: Array<[number, number]> = []
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      const y = top - (top - bottom) * t
      prof.push([hw * 0.985 + (rb - hw * 0.985) * Math.pow(t, 0.85), y])
    }
    prof.reverse()
    const skirt = lathe(prof, outfit === 'kaftan' ? 0.78 : 0.82, skirtW(top, bottom, hw), 30)
    groups.top.push(skirt)
    // hem band
    groups.trim.push({ geo: new THREE.TorusGeometry(rb, 0.008, 4, 30).rotateX(Math.PI / 2).scale(1, 1, outfit === 'kaftan' ? 0.78 : 0.82).translate(0, bottom + 0.01, 0), weights: skirtW(top, bottom, hw) })
  }

  // ---- arms
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R'
    const sh = V('upperArm' + k)
    const el = V('foreArm' + k)
    const wr = V('hand' + k)
    // shoulder cap blends chest <-> arm
    const sleeve = outfit === 'kaftan' || outfit === 'dress'
    const upperR0 = female ? 0.048 : 0.056
    const shoulderBall = ball(sh.clone().add(new THREE.Vector3(-s * 0.012, -0.012, 0)), upperR0 * 1.08, [['upperArm' + k, 0.55], ['clav' + k, 0.3], ['chest', 0.15]], 1, 0.95, 0.92)
    groups.top.push(shoulderBall)
    // clavicle bridge under the garment
    groups.top.push(tube(V('clav' + k), sh, 0.06, upperR0 * 1.15, 'clav' + k, 'chest', 'upperArm' + k, { seg: 12, len: 3 }))
    const sl = sleeve ? 0.012 : 0.006
    groups.top.push(tube(sh, el, upperR0 + sl, upperR0 * 0.82 + sl, 'upperArm' + k, 'clav' + k, 'foreArm' + k, { seg: 14, len: 8 }))
    groups[sleeve ? 'top' : 'skin'].push(ball(el, upperR0 * 0.8 + (sleeve ? sl : 0), [['upperArm' + k, 0.5], ['foreArm' + k, 0.5]], 1, 1, 1, 12))
    if (sleeve) {
      groups.top.push(tube(el, wr.clone().add(new THREE.Vector3(0, 0.03, 0)), upperR0 * 0.82 + sl, upperR0 * 0.7 + sl, 'foreArm' + k, 'upperArm' + k, null, { seg: 14, len: 7 }))
      groups.trim.push(tube(wr.clone().add(new THREE.Vector3(0, 0.025, 0)), wr.clone().add(new THREE.Vector3(0, 0.04, 0)), upperR0 * 0.74 + sl, upperR0 * 0.74 + sl, 'foreArm' + k, null, null, { seg: 14, len: 1 }))
    } else {
      // short sleeve cuff, bare forearm
      groups.skin.push(tube(el, wr, upperR0 * 0.8, upperR0 * 0.6, 'foreArm' + k, 'upperArm' + k, 'hand' + k, { seg: 12, len: 7 }))
    }
    // hand: palm + wrist + fingers + thumb
    groups.skin.push(ball(wr, upperR0 * 0.62, [['hand' + k, 0.6], ['foreArm' + k, 0.4]], 0.9, 1, 1.1, 10))
    const palm = new THREE.BoxGeometry(0.03, 0.085, 0.075, 2, 3, 3)
    // round the box
    const pp = palm.attributes.position
    for (let i = 0; i < pp.count; i++) {
      const y = pp.getY(i)
      pp.setX(i, pp.getX(i) * (1 - Math.abs(y) * 2.2))
    }
    palm.translate(wr.x + s * 0.008, wr.y - 0.045, 0)
    groups.skin.push(rigid(palm, 'hand' + k))
    for (const [f, z, l] of FINGERS) {
      const b1 = V(f + '1' + k)
      const b2 = V(f + '2' + k)
      const tip = b2.clone().add(new THREE.Vector3(0, -0.036 * l, 0))
      const r = f === 'pinky' ? 0.0078 : 0.0092
      groups.skin.push(tube(b1.clone().add(new THREE.Vector3(0, 0.01, 0)), b2, r, r * 0.95, f + '1' + k, 'hand' + k, f + '2' + k, { seg: 8, len: 3, blend: 0.3 }))
      groups.skin.push(tube(b2, tip, r * 0.95, r * 0.8, f + '2' + k, f + '1' + k, null, { seg: 8, len: 3, blend: 0.3 }))
      groups.skin.push(ball(tip, r * 0.8, [[f + '2' + k, 1]], 1, 1, 1, 8))
      void z
    }
    const t1 = V('thumb1' + k)
    const t2 = V('thumb2' + k)
    const ttip = t2.clone().add(new THREE.Vector3(-s * 0.004, -0.03, 0.018))
    groups.skin.push(tube(t1, t2, 0.012, 0.01, 'thumb1' + k, 'hand' + k, 'thumb2' + k, { seg: 8, len: 3 }))
    groups.skin.push(tube(t2, ttip, 0.01, 0.0085, 'thumb2' + k, 'thumb1' + k, null, { seg: 8, len: 3 }))
    groups.skin.push(ball(ttip, 0.0085, [['thumb2' + k, 1]], 1, 1, 1, 8))
  }

  // ---- legs (trousers for kaftan/shirt, skin under a gown)
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R'
    const hip = V('thigh' + k)
    const knee = V('shin' + k)
    const ank = V('foot' + k)
    const legG = outfit === 'dress' ? 'skin' : 'bottom'
    const tr = outfit === 'dress' ? 0 : 0.008
    const thighR = female ? 0.082 : 0.078
    groups[legG].push(tube(hip.clone().add(new THREE.Vector3(0, 0.03, 0)), knee, thighR + tr, 0.052 + tr, 'thigh' + k, 'hips', 'shin' + k, { seg: 14, len: 8, sz: 1.05 }))
    groups[legG].push(ball(knee, 0.052 + tr, [['thigh' + k, 0.5], ['shin' + k, 0.5]], 1, 1, 1.05, 12))
    groups[legG].push(tube(knee, ank.clone().add(new THREE.Vector3(0, 0.03, 0)), 0.052 + tr, 0.036 + tr, 'shin' + k, 'thigh' + k, 'foot' + k, { seg: 14, len: 8 }))
    // calf muscle
    groups[legG].push(ball(knee.clone().lerp(ank, 0.3).add(new THREE.Vector3(0, 0, -0.012)), 0.05 + tr, [['shin' + k, 1]], 1, 1.9, 1, 12))
    // shoe: heel to toe, skinned to foot + toe
    const toe = V('toe' + k)
    const shoe = new THREE.CapsuleGeometry(0.047, 0.17, 4, 12).rotateX(Math.PI / 2).scale(1, 0.62, 1)
    shoe.translate(ank.x, 0.045, (ank.z + toe.z) / 2 + 0.012)
    groups.shoe.push({ geo: shoe, weights: (p) => (p.z > toe.z - 0.03 ? [['toe' + k, 0.6], ['foot' + k, 0.4]] : [['foot' + k, 1]]) })
    const sole = new THREE.BoxGeometry(0.1, 0.022, 0.27, 1, 1, 4)
    sole.translate(ank.x, 0.011, (ank.z + toe.z) / 2 + 0.012)
    groups.sole.push({ geo: sole, weights: (p) => (p.z > toe.z - 0.03 ? [['toe' + k, 0.6], ['foot' + k, 0.4]] : [['foot' + k, 1]]) })
    groups.skin.push(tube(ank.clone().add(new THREE.Vector3(0, 0.02, 0)), ank.clone().add(new THREE.Vector3(0, 0.07, 0)), 0.036, 0.036, 'foot' + k, 'shin' + k, null, { seg: 10, len: 2 }))
  }

  // ---- neck + head
  const nk = V('neck')
  const hd = V('head')
  groups.skin.push(tube(nk.clone().add(new THREE.Vector3(0, -0.03, 0)), hd.clone().add(new THREE.Vector3(0, 0.03, 0)), female ? 0.045 : 0.054, female ? 0.042 : 0.05, 'neck', 'chest', 'head', { seg: 14, len: 4 }))
  const H = (x: number, y: number, z: number) => new THREE.Vector3(hd.x + x, hd.y + y, hd.z + z)
  const head: W = [['head', 1]]
  groups.skin.push(ball(H(0, 0.1, -0.005), 0.104, head, 0.9, 1.06, 1.04, 28)) // cranium
  groups.skin.push(ball(H(0, 0.045, 0.03), 0.082, head, 0.92, 0.95, 0.95, 20)) // face / cheeks
  groups.skin.push(ball(H(0, 0.012, 0.055), 0.042, head, 1.15, 0.8, 0.9, 16)) // jaw / chin
  for (const s of [1, -1]) {
    groups.skin.push(ball(H(s * 0.093, 0.085, -0.005), 0.022, head, 0.45, 1, 0.75, 10)) // ears
    // eyes: white, dark iris, a lid crease of skin above each
    groups.eye.push(ball(H(s * 0.035, 0.103, 0.0905), 0.0165, head, 1.2, 0.78, 0.55, 14))
    groups.iris.push(ball(H(s * 0.035, 0.102, 0.0985), 0.0085, head, 1, 1.05, 0.45, 12))
    groups.skin.push(ball(H(s * 0.035, 0.113, 0.0885), 0.017, head, 1.25, 0.42, 0.62, 12))
    groups.brow.push(rigid(new THREE.CapsuleGeometry(0.0045, 0.026, 2, 6).rotateZ(Math.PI / 2 - s * 0.12).translate(hd.x + s * 0.035, hd.y + 0.125, hd.z + 0.087), 'head'))
  }
  // nose: bridge + tip + nostrils
  groups.skin.push(ball(H(0, 0.085, 0.092), 0.013, head, 0.9, 2.1, 1, 10))
  groups.skin.push(ball(H(0, 0.062, 0.1), 0.018, head, 1.35, 0.95, 1, 12))
  // lips
  groups.lip.push(rigid(new THREE.CapsuleGeometry(0.0085, 0.03, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.85, 0.7).translate(hd.x, hd.y + 0.034, hd.z + 0.086), 'head'))
  groups.lip.push(rigid(new THREE.CapsuleGeometry(0.009, 0.026, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.9, 0.7).translate(hd.x, hd.y + 0.021, hd.z + 0.082), 'head'))

  // ---- hair / caps / hijab
  if (look.hijab) {
    const open = 2.0
    const hood = new THREE.SphereGeometry(0.122, 26, 18, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, Math.PI * 0.8)
    hood.scale(0.95, 1.1, 1.06)
    hood.translate(hd.x, hd.y + 0.09, hd.z - 0.004)
    groups.cap.push(rigid(hood, 'head'))
    groups.cap.push(rigid(new THREE.TorusGeometry(0.094, 0.013, 8, 22, Math.PI * 1.25).rotateZ(-Math.PI * 0.125).translate(hd.x, hd.y + 0.085, hd.z + 0.06), 'head'))
    // drape over the shoulders (follows neck + chest)
    const drape = new THREE.CylinderGeometry(0.1, 0.25, 0.3, 24, 4, true)
    drape.scale(1, 1, 0.85)
    drape.translate(hd.x, hd.y - 0.08, hd.z - 0.01)
    groups.cap.push({ geo: drape, weights: (p) => (p.y > hd.y - 0.05 ? [['head', 0.7], ['neck', 0.3]] : [['neck', 0.4], ['chest', 0.6]]) })
  } else {
    if (look.hair === 'afro') groups.hair.push(ball(H(0, 0.135, -0.012), 0.135, head, 1.02, 0.86, 1.0, 22))
    else if (look.hair !== 'bald' || look.kufi) {
      // close crop that hugs the cranium
      const crop = new THREE.SphereGeometry(0.108, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.52)
      crop.scale(0.92, 1.06, 1.06)
      crop.rotateX(-0.28)
      crop.translate(hd.x, hd.y + 0.108, hd.z - 0.012)
      groups.hair.push(rigid(crop, 'head'))
    }
    if (look.hair === 'braids') {
      for (let i = -3; i <= 3; i++) {
        const b = new THREE.CapsuleGeometry(0.011, 0.2, 3, 6)
        b.translate(hd.x + i * 0.026, hd.y - 0.01, hd.z - 0.085 + Math.abs(i) * 0.008)
        groups.hair.push({ geo: b, weights: (p) => (p.y > hd.y + 0.02 ? [['head', 1]] : [['head', 0.5], ['neck', 0.5]]) })
      }
    }
    if (look.kufi) {
      // kufi seated on the crown, tilted back slightly like it's worn
      groups.cap.push(rigid(new THREE.CylinderGeometry(0.094, 0.1, 0.07, 28).rotateX(-0.12).translate(hd.x, hd.y + 0.17, hd.z - 0.014), 'head'))
      groups.trim.push(rigid(new THREE.CylinderGeometry(0.101, 0.101, 0.014, 28).rotateX(-0.12).translate(hd.x, hd.y + 0.14, hd.z - 0.012), 'head'))
    }
  }
  if (look.beard && !look.hijab) {
    // beard: a shell hugging the jaw and chin + moustache
    const beard = new THREE.SphereGeometry(0.086, 24, 12, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.5, Math.PI * 0.38)
    beard.scale(0.95, 0.95, 1.0)
    beard.translate(hd.x, hd.y + 0.068, hd.z + 0.012)
    groups.hair.push(rigid(beard, 'head'))
    groups.hair.push(rigid(new THREE.CapsuleGeometry(0.0055, 0.034, 2, 8).rotateZ(Math.PI / 2).translate(hd.x, hd.y + 0.048, hd.z + 0.097), 'head'))
  }

  // ---- materials + skinned meshes (all share one skeleton)
  const std = (color: string, roughness = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra })
  const MAT: Record<string, THREE.Material> = {
    skin: std(look.skin, 0.55),
    top: std(look.top, 0.88, { side: THREE.DoubleSide }),
    bottom: std(look.bottom, 0.9),
    shoe: std('#1e1b1a', 0.45),
    sole: std('#e8e4dc', 0.7),
    hair: std(look.hairColor, 0.95),
    cap: std(look.hijab ? look.top === '#efe8d6' ? '#3a5a8a' : '#efe8d6' : '#f1ece0', 0.9, { side: THREE.DoubleSide }),
    trim: std('#e6c66a', 0.5),
    eye: std('#f4f1ea', 0.25),
    iris: std('#1a0f0a', 0.15),
    lip: std(new THREE.Color(look.skin).multiplyScalar(0.62).getStyle(), 0.6),
    brow: std(look.hairColor, 0.9)
  }
  const geos: THREE.BufferGeometry[] = []
  for (const [name, pieces] of Object.entries(groups)) {
    const g = bake(pieces, boneIndex)
    if (!g) continue
    geos.push(g)
    const m = new THREE.SkinnedMesh(g, MAT[name])
    m.castShadow = true
    m.frustumCulled = false
    m.bind(skeleton, new THREE.Matrix4())
    root.add(m)
  }

  return {
    root,
    bones,
    rest,
    dispose() {
      for (const g of geos) g.dispose()
      for (const m of Object.values(MAT)) m.dispose()
      skeleton.dispose()
    }
  }
}
