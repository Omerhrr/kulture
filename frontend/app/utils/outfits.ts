// outfits - what people wear on the realistic bodies (utils/humanBody):
// tops, bottoms, shoes, hair and facial hair, each chosen by the player.
//
// Garments are cut from the body's own surface (by body region and the
// height of the joints) and pushed out along the normals, so they fit every
// body shape and move with the same skin weights. Skin under clothing is
// left out of the body mesh, so nothing pokes through. A skirt is the one
// free-hanging piece: a flared cloth weighted between the hips and legs.
import * as THREE from 'three'
import { REGION, type BodyBase } from './humanBody'

export const TOPS = ['tee', 'polo', 'longsleeve', 'shirt', 'tank'] as const
export const BOTTOMS = ['jeans', 'trousers', 'shorts', 'skirt'] as const
export const SHOES = ['sneakers', 'shoes', 'sandals', 'boots'] as const
export const HAIRS = ['lowcut', 'fade', 'afro', 'puff', 'cornrows', 'braids', 'locs', 'bald'] as const
export const BEARDS = ['none', 'stubble', 'full'] as const
export type TopStyle = (typeof TOPS)[number]
export type BottomStyle = (typeof BOTTOMS)[number]
export type ShoeStyle = (typeof SHOES)[number]
export type HairStyle = (typeof HAIRS)[number]
export type BeardStyle = (typeof BEARDS)[number]

export const LABELS: Record<string, string> = {
  tee: 'T-shirt', polo: 'Polo', longsleeve: 'Long sleeve', shirt: 'Shirt', tank: 'Tank top',
  jeans: 'Jeans', trousers: 'Trousers', shorts: 'Shorts', skirt: 'Skirt',
  sneakers: 'Sneakers', shoes: 'Shoes', sandals: 'Sandals', boots: 'Boots',
  lowcut: 'Low cut', fade: 'Fade', afro: 'Afro', puff: 'Afro puff', cornrows: 'Cornrows', braids: 'Braids', locs: 'Locs', bald: 'Bald',
  none: 'Clean shaven', stubble: 'Stubble', full: 'Beard'
}

export interface Outfit {
  top: TopStyle
  topColor: string
  bottom: BottomStyle
  bottomColor: string
  shoes: ShoeStyle
  shoeColor: string
  hair: HairStyle
  hairColor: string
  beard?: BeardStyle
}

/** A garment: body triangles it covers + how far it stands off the skin. */
interface Piece {
  tris: number[]
  offset: (o: number) => number
  mat: THREE.Material
  color?: (o: number) => [number, number, number]
  /** soft edge: alpha per vertex, cut at 0.5 */
  alpha?: (o: number) => number
}

// ------------------------------------------------------------------ fabrics
const fabricCache = new Map<string, THREE.Texture>()
function fabric(kind: 'knit' | 'denim' | 'twill' | 'leather' | 'hair' | 'coarse'): THREE.Texture {
  const hit = fabricCache.get(kind)
  if (hit) return hit
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')!
  const img = g.createImageData(S, S)
  const rnd = (x: number, y: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return h - Math.floor(h)
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0.86
      if (kind === 'knit') v = 0.84 + ((x + (y >> 1)) % 4 < 2 ? 0.05 : -0.02) + (rnd(x, y) - 0.5) * 0.06
      else if (kind === 'denim') v = 0.78 + ((x + y) % 4 < 2 ? 0.1 : -0.04) + (rnd(x, y >> 2) - 0.5) * 0.12
      else if (kind === 'twill') v = 0.86 + ((x + y) % 6 < 3 ? 0.04 : -0.03) + (rnd(x, y) - 0.5) * 0.04
      else if (kind === 'leather') v = 0.82 + (rnd(x >> 2, y >> 2) - 0.5) * 0.12 + (rnd(x, y) - 0.5) * 0.05
      else if (kind === 'hair') v = 0.7 + (rnd(x, y >> 3) - 0.5) * 0.5
      else v = 0.75 + (rnd(x >> 1, y >> 1) - 0.5) * 0.4
      const c = Math.max(0, Math.min(255, v * 255))
      const i = (y * S + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(kind === 'hair' || kind === 'coarse' ? 18 : 26, kind === 'hair' || kind === 'coarse' ? 18 : 26)
  t.colorSpace = THREE.SRGBColorSpace
  fabricCache.set(kind, t)
  return t
}
const cloth = (color: string, kind: Parameters<typeof fabric>[0], rough = 0.9) =>
  new THREE.MeshStandardMaterial({ color, map: fabric(kind), roughness: rough, metalness: 0, side: THREE.DoubleSide })

// ------------------------------------------------------------------ landmarks
interface Marks {
  shoulder: number
  elbow: number
  wrist: number
  neck: number
  chest: number
  waist: number
  hip: number
  knee: number
  ankle: number
  head: THREE.Vector3
  headSize: THREE.Vector3
}
function landmarks(base: BodyBase, p: Float32Array): Marks {
  const J = base.joints
  const y = (n: string) => J[n]![1]
  // the head: bounding box of the head-region vertices above the jaw
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity)
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (let o = 0; o < base.region.length; o++) {
    if (base.region[o] !== REGION.head) continue
    lo.min(new THREE.Vector3(p[o * 3], p[o * 3 + 1], p[o * 3 + 2]))
    hi.max(new THREE.Vector3(p[o * 3], p[o * 3 + 1], p[o * 3 + 2]))
  }
  return {
    shoulder: y('upperArmL'),
    elbow: y('foreArmL'),
    wrist: y('handL'),
    neck: y('neck'),
    chest: y('chest'),
    waist: (y('hips') + y('spine')) / 2 + 0.03,
    hip: y('thighL'),
    knee: y('shinL'),
    ankle: y('footL'),
    head: lo.clone().add(hi).multiplyScalar(0.5),
    headSize: hi.clone().sub(lo).multiplyScalar(0.5)
  }
}

// ------------------------------------------------------------------ helpers
/** triangles whose three corners all pass `cover` */
function trisWhere(base: BodyBase, cover: (o: number) => boolean): number[] {
  const out: number[] = []
  const so = base.splitOrig
  const ix = base.index
  for (let t = 0; t < ix.length / 3; t++) {
    if (cover(so[ix[t * 3]!]!) && cover(so[ix[t * 3 + 1]!]!) && cover(so[ix[t * 3 + 2]!]!)) out.push(t)
  }
  return out
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const OUT = -1 // margin for "not this garment's region"

/**
 * Cut a garment out of the body by a signed margin m(o) (> 0 = covered).
 * Triangles reaching into the soft band are kept and alpha-cut at m = 0,
 * so the edge is a smooth curve through the triangles, not a staircase.
 */
function cut(base: BodyBase, m: (o: number) => number, band: number) {
  return {
    tris: trisWhere(base, (o) => m(o) > -band),
    alpha: (o: number) => 0.5 + 0.5 * Math.max(-1, Math.min(1, m(o) / band)),
    /** fully under the garment (its skin can go) */
    under: (o: number) => m(o) > band
  }
}
function softMat(m: THREE.MeshStandardMaterial) {
  m.vertexColors = true
  m.alphaTest = 0.5
  return m
}

// ------------------------------------------------------------------ dress
export interface Dressed {
  /** body triangles left visible (skin) */
  skinTris: number[]
  pieces: Piece[]
  /** extra skinned meshes not cut from the body (skirt, braids, collars...) */
  extras: Array<{ geo: THREE.BufferGeometry; mat: THREE.Material }>
}

/**
 * Work out the garments for an outfit on a body. `bone` maps game bone
 * names to skeleton indices (for the free pieces' skin weights).
 */
export function dress(base: BodyBase, p: Float32Array, n: Float32Array, outfit: Outfit, bone: Record<string, number>, skin = '#6e4630'): Dressed {
  const M = landmarks(base, p)
  const R = base.region
  const Y = (o: number) => p[o * 3 + 1]!
  const X = (o: number) => p[o * 3]!
  const Z = (o: number) => p[o * 3 + 2]!
  const pieces: Piece[] = []
  const extras: Dressed['extras'] = []
  const covered = new Uint8Array(R.length)
  const garment = (m: (o: number) => number, band: number, offset: (o: number) => number, mat: THREE.MeshStandardMaterial, hides = true) => {
    const c = cut(base, m, band)
    pieces.push({ tris: c.tris, offset, mat: softMat(mat), alpha: c.alpha })
    if (hides) for (let o = 0; o < R.length; o++) if (c.under(o)) covered[o] = 1
  }

  // ---- top
  const top = outfit.top
  // untucked, a hand below the waistband (the hip joint itself is crotch height)
  const hem = M.hip + (M.waist - M.hip) * 0.35
  const sleeveEnd = top === 'tee' || top === 'polo' ? M.shoulder - (M.shoulder - M.elbow) * 0.55 : top === 'tank' ? Infinity : M.wrist + 0.035
  const scoop = top === 'tee' || top === 'tank'
  const mTop = (o: number) => {
    const r = R[o]
    const y = Y(o)
    if (r === REGION.torso) {
      let m = 1
      // round neckline in front
      if (scoop && Z(o) > 0) m = Math.min(m, 0.04 * ((X(o) / 0.085) ** 2 + ((y - M.neck) / 0.075) ** 2 - 1))
      // tank: deep armholes
      if (top === 'tank') m = Math.min(m, -0.05 * (1 - ((Math.abs(X(o)) - 0.2) / 0.075) ** 2 - ((y - M.shoulder) / 0.14) ** 2))
      return m
    }
    if (r === REGION.hips) return y - hem
    if (r === REGION.upperArm || r === REGION.foreArm) return y - sleeveEnd
    return OUT
  }
  garment(mTop, 0.012, (o) => (R[o] === REGION.hips ? 0.014 : R[o] === REGION.foreArm ? 0.011 : R[o] === REGION.upperArm ? 0.01 : 0.009), cloth(outfit.topColor, top === 'shirt' ? 'twill' : 'knit'))
  if (top === 'polo' || top === 'shirt') extras.push(collar(base, p, M, outfit.topColor, bone, top === 'shirt'))

  // ---- bottom
  const bottom = outfit.bottom
  const legEnd = bottom === 'shorts' ? M.knee + 0.06 : bottom === 'skirt' ? M.hip - 0.12 : M.ankle + 0.035
  const mBottom = (o: number) => {
    const r = R[o]
    const y = Y(o)
    if (r === REGION.hips) return Math.min(M.waist - y, y - legEnd)
    if (r === REGION.torso) return Math.min(M.waist - y, y - (M.hip - 0.2))
    if (r === REGION.thigh || r === REGION.shin) return y - legEnd
    return OUT
  }
  garment(mBottom, 0.012, (o) => (bottom === 'skirt' ? 0.004 : R[o] === REGION.shin ? 0.018 : R[o] === REGION.thigh ? 0.014 : 0.008), cloth(outfit.bottomColor, bottom === 'jeans' ? 'denim' : 'twill'))
  if (bottom === 'skirt') extras.push(skirt(base, p, M, outfit.bottomColor, bone))

  // ---- shoes
  const shoes = outfit.shoes
  const heelZ = base.joints.footL![2]
  const toeZ = base.joints.toeL![2]
  const mShoe = (o: number) => {
    const r = R[o]
    const y = Y(o)
    if (shoes === 'sandals') {
      if (r !== REGION.foot) return OUT
      // the sole + one strap across the instep; toes and heel stay bare
      const sole = 0.016 - y
      const strap = Math.min(y - 0.03, 0.058 - y, Z(o) - (heelZ + 0.03), toeZ - 0.01 - Z(o))
      return Math.max(sole, strap)
    }
    if (r === REGION.foot) return 1
    if (r === REGION.shin) return M.ankle + (shoes === 'boots' ? 0.13 : 0.035) - y
    return OUT
  }
  garment(
    mShoe,
    0.006,
    (o) => (shoes === 'sandals' ? 0.004 : Z(o) > toeZ - 0.015 ? 0.022 : Y(o) < 0.03 ? 0.016 : 0.012),
    cloth(outfit.shoeColor, shoes === 'sneakers' ? 'knit' : 'leather', shoes === 'shoes' ? 0.45 : 0.75),
    shoes !== 'sandals'
  )
  if (shoes === 'sneakers') extras.push(...soles(base, p, bone))
  if (shoes === 'sandals') extras.push(...soles(base, p, bone, '#3a2a1e', 0.014))

  // ---- hair (+ facial hair)
  hair(base, p, M, outfit, skin, bone, pieces, extras)

  // skin stays wherever it is not fully under cloth (soft edges overlap it)
  const skinTris = trisWhere(base, () => true).filter((t) => {
    const so = base.splitOrig
    const ix = base.index
    return !(covered[so[ix[t * 3]!]!] && covered[so[ix[t * 3 + 1]!]!] && covered[so[ix[t * 3 + 2]!]!])
  })
  return { skinTris, pieces, extras }
}

// ------------------------------------------------------------------ hair
function hair(base: BodyBase, p: Float32Array, M: Marks, o: Outfit, skin: string, bone: Record<string, number>, pieces: Piece[], extras: Dressed['extras']) {
  const R = base.region
  const C = M.head
  const E = M.headSize
  // head-space coords: u up, w front, s side (each about -1..1)
  const U = (i: number) => (p[i * 3 + 1]! - C.y) / E.y
  const Wf = (i: number) => (p[i * 3 + 2]! - C.z) / E.z
  const Sd = (i: number) => (p[i * 3]! - C.x) / E.x
  // Head coords from the head's bounding box: u -1 chin .. +1 crown (nose
  // tip ~ -0.23, mouth ~ -0.5, brows ~ +0.15), w front, s side (ears ~ 1).
  // Natural hairline, one smooth curve: high on the forehead (~5 cm above
  // the brows), lifting over the ears, down to the nape.
  const line = (i: number) => {
    if (R[i] !== REGION.head) return OUT
    const w = Wf(i)
    const s = Math.abs(Sd(i))
    const overEar = 0.28 * Math.exp(-(((w + 0.15) / 0.3) ** 2)) * smooth(0.55, 0.9, s)
    return U(i) - (0.08 + 0.62 * w + overEar)
  }
  const style = o.hair
  const band = 0.09
  if (style !== 'bald') {
    const mat = softMat(new THREE.MeshStandardMaterial({ color: o.hairColor, map: fabric(style === 'afro' || style === 'puff' ? 'coarse' : 'hair'), roughness: 0.95, metalness: 0, side: THREE.DoubleSide }))
    // afro: a rounded crown (the surface is pushed out to a sphere around
    // the head, fuller on top), tapering into the hairline
    const AC = C.clone().add(new THREE.Vector3(0, E.y * 0.2, -E.z * 0.2))
    const AR = Math.max(E.x, E.y, E.z) * 1.18
    const afro = (i: number) => {
      const d = Math.hypot(p[i * 3]! - AC.x, p[i * 3 + 1]! - AC.y, p[i * 3 + 2]! - AC.z)
      return Math.max(0.006, AR * (1 + 0.08 * smooth(-0.2, 0.9, U(i))) - d)
    }
    const thick =
      style === 'fade' ? (i: number) => 0.002 + 0.006 * smooth(0.35, 0.8, U(i))
      : style === 'lowcut' || style === 'puff' ? () => 0.004
      : style === 'afro' ? afro
      : () => 0.007
    // volume builds up behind the hairline (an afro over ~7 cm: no brim)
    const edge = style === 'afro' ? (i: number) => smooth(-band, 0.6, line(i)) : (i: number) => smooth(-band, band * 2, line(i))
    // cornrows / braids: rows running front to back (shaded across the head)
    const color =
      style === 'cornrows' || style === 'braids'
        ? (i: number): [number, number, number] => {
            const k = 0.7 + 0.3 * Math.abs(Math.sin(Sd(i) * 11))
            return [k, k, k]
          }
        : undefined
    const c = cut(base, line, band)
    pieces.push({ tris: c.tris, offset: (i) => 0.0012 + thick(i) * edge(i), mat, color, alpha: c.alpha })
    if (style === 'puff') extras.push(ball(C.clone().add(new THREE.Vector3(0, E.y * 0.75, -E.z * 0.55)), 0.085, o.hairColor, bone.head!))
    if (style === 'braids' || style === 'locs') extras.push(strands(M, o.hairColor, bone, style === 'locs'))
  }
  // facial hair along the jaw and chin (lips left clear), up to sideburns
  if (o.beard && o.beard !== 'none') {
    const beard = (i: number) => {
      if (R[i] !== REGION.head) return OUT
      const u = U(i)
      const w = Wf(i)
      const s = Sd(i)
      // below a line from the sideburns down the cheek to the mouth corners
      const cheek = -0.05 - 0.42 * smooth(-0.25, 0.75, w) - u
      // moustache over the upper lip
      const tache = 0.05 * (1 - (s / 0.38) ** 2 - ((u + 0.375) / 0.05) ** 2)
      // the lips stay clear (an oval opening)
      const lips = 0.08 * (1 - (s / 0.31) ** 2 - ((u + 0.53) / 0.12) ** 2)
      return Math.min(Math.max(cheek, w > 0.5 ? tache : OUT), -lips, w + 0.25)
    }
    const stubble = o.beard === 'stubble'
    // stubble: a short shadow - the person's own skin, darkened and grainy
    const tone = stubble ? new THREE.Color(skin).multiplyScalar(0.62).lerp(new THREE.Color(o.hairColor), 0.25) : new THREE.Color(o.hairColor)
    const mat = softMat(new THREE.MeshStandardMaterial({ color: tone, map: fabric('hair'), roughness: 0.95, side: THREE.DoubleSide }))
    const c = cut(base, beard, 0.06)
    pieces.push({ tris: c.tris, offset: () => (stubble ? 0.0012 : 0.0055), mat, alpha: c.alpha })
  }
}

// ------------------------------------------------------------------ free pieces
function skinned(geo: THREE.BufferGeometry, weights: (p: THREE.Vector3) => Array<[number, number]>) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const si = new Uint16Array(pos.count * 4)
  const sw = new Float32Array(pos.count * 4)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const w = weights(v).slice(0, 4)
    const tot = w.reduce((a, [, x]) => a + x, 0) || 1
    w.forEach(([b, x], k) => {
      si[i * 4 + k] = b
      sw[i * 4 + k] = x / tot
    })
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
  return geo
}

/** A-line skirt from the waist to just above the knee; swings with the legs. */
function skirt(base: BodyBase, p: Float32Array, M: Marks, color: string, bone: Record<string, number>) {
  // hip girth at the waist / widest point
  let rx = 0
  let zf = -Infinity
  let zb = Infinity
  for (let o = 0; o < base.region.length; o++) {
    const r = base.region[o]
    if (r !== REGION.hips && r !== REGION.thigh) continue
    const y = p[o * 3 + 1]!
    if (y < M.hip - 0.12 || y > M.waist) continue
    rx = Math.max(rx, Math.abs(p[o * 3]!))
    zf = Math.max(zf, p[o * 3 + 2]!)
    zb = Math.min(zb, p[o * 3 + 2]!)
  }
  const cz = (zf + zb) / 2
  const rz = (zf - zb) / 2
  const top = M.waist
  const bottom = M.knee + 0.04
  const flare = 1.5
  const g = new THREE.CylinderGeometry(1, flare, 1, 36, 6, true)
  g.translate(0, -0.5, 0)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const t = -pos.getY(i) // 0 top .. 1 hem
    pos.setXYZ(i, pos.getX(i) * (rx + 0.012), top - t * (top - bottom), cz + pos.getZ(i) * (rz + 0.014))
  }
  g.computeVertexNormals()
  const b = (k: string) => bone[k]!
  skinned(g, (v) => {
    const t = Math.min(1, Math.max(0, (top - v.y) / (top - bottom)))
    const side = Math.min(1, Math.max(0, 0.5 + v.x / (rx * 2.2)))
    const leg = Math.min(0.8, t * 1.1)
    return [[b('hips'), 1 - leg], [b('thighL'), leg * side], [b('thighR'), leg * (1 - side)]]
  })
  return { geo: g, mat: cloth(color, 'twill') }
}

/** Shirt / polo collar: a stand collar sized to this neck, open at the
 *  front, with buttons down the placket. */
function collar(base: BodyBase, p: Float32Array, M: Marks, color: string, bone: Record<string, number>, shirt: boolean) {
  // the neck's centre + radii at the collar line
  let n = 0
  let cx = 0
  let cz = 0
  for (let o = 0; o < base.region.length; o++) {
    if (base.region[o] !== REGION.neck || Math.abs(p[o * 3 + 1]! - M.neck) > 0.025) continue
    cx += p[o * 3]!
    cz += p[o * 3 + 2]!
    n++
  }
  cx /= n || 1
  cz /= n || 1
  let rx = 0.05
  let rz = 0.05
  for (let o = 0; o < base.region.length; o++) {
    if (base.region[o] !== REGION.neck || Math.abs(p[o * 3 + 1]! - M.neck) > 0.025) continue
    rx = Math.max(rx, Math.abs(p[o * 3]! - cx))
    rz = Math.max(rz, Math.abs(p[o * 3 + 2]! - cz))
  }
  const parts: THREE.BufferGeometry[] = []
  const gap = shirt ? 0.35 : 0.6 // open front (theta 0 = +z)
  const band = new THREE.CylinderGeometry(1.0, 1.12, 1, 32, 1, true, gap / 2, Math.PI * 2 - gap)
  band.scale(rx + 0.014, 0.04, rz + 0.014)
  band.translate(cx, M.neck - 0.012, cz)
  parts.push(band)
  const front = cz + rz + 0.022
  const buttons = shirt ? 5 : 2
  for (let i = 0; i < buttons; i++) parts.push(new THREE.SphereGeometry(0.0045, 6, 4).translate(cx, M.neck - 0.05 - i * 0.075, front + 0.004 - i * 0.002))
  const g = mergeAll(parts)
  skinned(g, (v) => (v.y > M.neck - 0.035 ? [[bone.neck!, 0.4], [bone.chest!, 0.6]] : [[bone.chest!, 1]]))
  return { geo: g, mat: cloth(color, 'twill') }
}

/** Sneaker soles: a rubber slab under each foot, along heel -> toe. */
function soles(base: BodyBase, p: Float32Array, bone: Record<string, number>, color = '#f2f0ea', thick = 0.022) {
  const out: Dressed['extras'] = []
  for (const k of ['L', 'R']) {
    const heel = base.joints['foot' + k]!
    const toe = base.joints['toe' + k]!
    const dx = toe[0] - heel[0]
    const dz = toe[2] - heel[2]
    const dl = Math.hypot(dx, dz) || 1
    const fx = dx / dl
    const fz = dz / dl
    // foot extents along the foot (a) and across it (c)
    let a0 = Infinity
    let a1 = -Infinity
    let c0 = Infinity
    let c1 = -Infinity
    for (let o = 0; o < base.region.length; o++) {
      if (base.region[o] !== REGION.foot || Math.sign(p[o * 3]!) !== Math.sign(heel[0])) continue
      const rx = p[o * 3]! - heel[0]
      const rz = p[o * 3 + 2]! - heel[2]
      const a = rx * fx + rz * fz
      const c = rx * fz - rz * fx
      a0 = Math.min(a0, a)
      a1 = Math.max(a1, a)
      c0 = Math.min(c0, c)
      c1 = Math.max(c1, c)
    }
    const g = new THREE.BoxGeometry(c1 - c0 + 0.03, thick, a1 - a0 + 0.035, 1, 1, 3)
    g.translate((c0 + c1) / 2, thick / 2 - 0.008, (a0 + a1) / 2)
    g.rotateY(Math.atan2(fx, fz))
    g.translate(heel[0], 0, heel[2])
    const toeZ = toe[2]
    skinned(g, (v) => (v.z > toeZ ? [[bone['toe' + k]!, 0.7], [bone['foot' + k]!, 0.3]] : [[bone['foot' + k]!, 1]]))
    out.push({ geo: g, mat: new THREE.MeshStandardMaterial({ color, roughness: 0.7 }) })
  }
  return out
}

function ball(c: THREE.Vector3, r: number, color: string, headBone: number) {
  const g = new THREE.SphereGeometry(r, 18, 12).translate(c.x, c.y, c.z)
  skinned(g, () => [[headBone, 1]])
  return { geo: g, mat: new THREE.MeshStandardMaterial({ color, map: fabric('coarse'), roughness: 0.95 }) }
}

/** Box braids / locs hanging from the back of the head to the shoulders. */
function strands(M: Marks, color: string, bone: Record<string, number>, locs: boolean) {
  const parts: THREE.BufferGeometry[] = []
  const C = M.head
  const E = M.headSize
  const n = locs ? 22 : 30
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.15 + 0.7 * (i / (n - 1))) // around the back
    const x = Math.cos(a) * E.x * 0.95
    const z = -Math.sin(a) * E.z * 0.9
    const len = locs ? 0.32 : 0.36
    const r = locs ? 0.011 : 0.007
    const g = new THREE.CapsuleGeometry(r, len, 3, 6)
    g.translate(C.x + x * 1.02, C.y - len / 2 + E.y * 0.15, C.z + z * 1.02 - 0.01)
    parts.push(g)
  }
  const g = mergeAll(parts)
  skinned(g, (v) => (v.y > M.neck + 0.05 ? [[bone.head!, 1]] : v.y > M.neck - 0.04 ? [[bone.head!, 0.5], [bone.neck!, 0.5]] : [[bone.neck!, 0.4], [bone.chest!, 0.6]]))
  return { geo: g, mat: new THREE.MeshStandardMaterial({ color, map: fabric('hair'), roughness: 0.9 }) }
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // tiny local merge (positions + normals + index) to avoid an import cycle
  let nv = 0
  let ni = 0
  for (const g of gs) {
    if (!g.index) g.setIndex([...Array(g.attributes.position!.count).keys()])
    nv += g.attributes.position!.count
    ni += g.index!.count
  }
  const pos = new Float32Array(nv * 3)
  const nor = new Float32Array(nv * 3)
  const idx: number[] = []
  let ov = 0
  for (const g of gs) {
    if (!g.attributes.normal) g.computeVertexNormals()
    pos.set(g.attributes.position!.array as Float32Array, ov * 3)
    nor.set(g.attributes.normal!.array as Float32Array, ov * 3)
    const gi = g.index!.array
    for (let i = 0; i < gi.length; i++) idx.push(gi[i]! + ov)
    ov += g.attributes.position!.count
    g.dispose()
  }
  void ni
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setIndex(idx)
  return out
}
