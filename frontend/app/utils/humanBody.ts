// humanBody - realistic people built from MakeHuman bodies (CC0), baked by
// scripts/build-humans.py into /models/human/{male,female}.bin.
//
// A person = one base body (per gender) + variety morphs (build + face),
// skinned to the game skeleton (same bone names as utils/humanRig, so
// utils/humanAnim + utils/rigDriver animate it unchanged), with fitted eyes.
// Clothes and hair are added by utils/outfits on top of the same body.
import * as THREE from 'three'
import type { HumanRig } from './humanRig'
import { dress, type Outfit } from './outfits'

export interface BodyBase {
  gender: 'male' | 'female'
  height: number
  bones: Array<{ name: string; parent: string | null }>
  joints: Record<string, [number, number, number]>
  morphNames: string[]
  pos: Float32Array // per body vertex (metres)
  splitOrig: Uint16Array // per render vertex: its body vertex
  uv: Float32Array // per render vertex
  index: Uint16Array // triangles over render vertices
  skinIndex: Uint8Array // per body vertex, 4 bones
  skinWeight: Uint8Array // per body vertex, 4 weights (0..255)
  region: Uint8Array // per body vertex: 0 head 1 neck 2 torso 3 hips 4 upperArm 5 foreArm 6 hand 7 thigh 8 shin 9 foot
  morphs: Record<string, { idx: Uint16Array; d: Float32Array }>
  eye: { refs: Uint16Array; w: Float32Array; off: Float32Array; orig: Uint16Array; uv: Float32Array; index: Uint16Array; scales: Record<string, [number, number, number]>; k: number }
}

export const REGION = { head: 0, neck: 1, torso: 2, hips: 3, upperArm: 4, foreArm: 5, hand: 6, thigh: 7, shin: 8, foot: 9 } as const

const cache = new Map<string, Promise<BodyBase>>()
const ready = new Map<string, BodyBase>()

/** Load (once) the base body for a gender. */
export function loadBody(gender: 'male' | 'female'): Promise<BodyBase> {
  let p = cache.get(gender)
  if (!p) {
    p = fetch(`/models/human/${gender}.bin`)
      .then((r) => {
        if (!r.ok) throw new Error(`human body ${gender}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        const b = parseBody(buf)
        ready.set(gender, b)
        return b
      })
    cache.set(gender, p)
  }
  return p
}
/** The base body if it has loaded already (synchronous build path). */
export const bodyIfLoaded = (gender: 'male' | 'female') => ready.get(gender)
export const preloadBodies = () => Promise.all([loadBody('male'), loadBody('female')])

function parseBody(buf: ArrayBuffer): BodyBase {
  const dv = new DataView(buf)
  const hl = dv.getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)))
  let off = 4 + hl
  const arr: Record<string, Float32Array | Uint16Array | Uint8Array> = {}
  for (const m of header.buffers as Array<{ name: string; type: string; count: number }>) {
    const bytes = m.type === 'f32' ? 4 : m.type === 'u16' ? 2 : 1
    const size = m.count * bytes
    // copy out (alignment of u16 / f32 views is 4-byte by construction)
    const view =
      m.type === 'f32' ? new Float32Array(buf.slice(off, off + size)) : m.type === 'u16' ? new Uint16Array(buf.slice(off, off + size)) : new Uint8Array(buf.slice(off, off + size))
    arr[m.name] = view
    off += size + ((4 - (size % 4)) % 4)
  }
  const morphs: BodyBase['morphs'] = {}
  for (const n of header.morphs as string[]) morphs[n] = { idx: arr[`morph:${n}:idx`] as Uint16Array, d: arr[`morph:${n}:d`] as Float32Array }
  return {
    gender: header.gender,
    height: header.height,
    bones: header.bones,
    joints: header.joints,
    morphNames: header.morphs,
    pos: arr.pos as Float32Array,
    splitOrig: arr.splitOrig as Uint16Array,
    uv: arr.uv as Float32Array,
    index: arr.index as Uint16Array,
    skinIndex: arr.skinIndex as Uint8Array,
    skinWeight: arr.skinWeight as Uint8Array,
    region: arr.region as Uint8Array,
    morphs,
    eye: {
      refs: arr['eye:refs'] as Uint16Array,
      w: arr['eye:w'] as Float32Array,
      off: arr['eye:off'] as Float32Array,
      orig: arr['eye:orig'] as Uint16Array,
      uv: arr['eye:uv'] as Float32Array,
      index: arr['eye:index'] as Uint16Array,
      scales: header.eyeScales,
      k: header.eyeK
    }
  }
}

// ------------------------------------------------------------------ a person
export interface BodySpec {
  gender: 'male' | 'female'
  skin: string
  /** morph weights (0..1): heavy, slim, muscular, noseWide, lipsFull ... */
  morphs?: Record<string, number>
}

/** Positions of the body vertices for a spec (base + weighted morphs). */
export function bodyPositions(base: BodyBase, morphs: Record<string, number> = {}): Float32Array {
  const p = base.pos.slice()
  for (const [n, w] of Object.entries(morphs)) {
    const m = base.morphs[n]
    if (!m || !w) continue
    for (let j = 0; j < m.idx.length; j++) {
      const i = m.idx[j]! * 3
      p[i] += m.d[j * 3]! * w
      p[i + 1] += m.d[j * 3 + 1]! * w
      p[i + 2] += m.d[j * 3 + 2]! * w
    }
  }
  return p
}

/** Smooth normals per body vertex (seam-free: UV splits share them). */
export function bodyNormals(base: BodyBase, p: Float32Array): Float32Array {
  const n = new Float32Array(p.length)
  const ix = base.index
  const so = base.splitOrig
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < ix.length; t += 3) {
    const i0 = so[ix[t]!]! * 3
    const i1 = so[ix[t + 1]!]! * 3
    const i2 = so[ix[t + 2]!]! * 3
    a.set(p[i1]! - p[i0]!, p[i1 + 1]! - p[i0 + 1]!, p[i1 + 2]! - p[i0 + 2]!)
    b.set(p[i2]! - p[i0]!, p[i2 + 1]! - p[i0 + 1]!, p[i2 + 2]! - p[i0 + 2]!)
    c.crossVectors(a, b) // area-weighted
    for (const i of [i0, i1, i2]) {
      n[i] += c.x
      n[i + 1] += c.y
      n[i + 2] += c.z
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1
    n[i] /= l
    n[i + 1] /= l
    n[i + 2] /= l
  }
  return n
}

/** The game skeleton at this body's joints (rest = identity rotations). */
export function buildSkeleton(base: BodyBase): { root: THREE.Group; bones: Record<string, THREE.Bone>; list: THREE.Bone[]; rest: Record<string, THREE.Vector3>; skeleton: THREE.Skeleton } {
  const root = new THREE.Group()
  const bones: Record<string, THREE.Bone> = {}
  const list: THREE.Bone[] = []
  for (const { name } of base.bones) {
    const b = new THREE.Bone()
    b.name = name
    bones[name] = b
    list.push(b)
  }
  for (const { name, parent } of base.bones) {
    const p = new THREE.Vector3(...base.joints[name]!)
    if (parent) {
      p.sub(new THREE.Vector3(...base.joints[parent]!))
      bones[parent]!.add(bones[name]!)
    } else root.add(bones[name]!)
    bones[name]!.position.copy(p)
  }
  root.updateMatrixWorld(true)
  const rest: Record<string, THREE.Vector3> = {}
  for (const n of Object.keys(bones)) rest[n] = bones[n]!.position.clone()
  return { root, bones, list, rest, skeleton: new THREE.Skeleton(list) }
}

/** Skinned geometry over a subset of body triangles (all when `tris` is
 *  omitted), optionally pushed out along the normals (clothes). */
export function skinnedGeometry(
  base: BodyBase,
  p: Float32Array,
  n: Float32Array,
  opts: { tris?: number[]; offset?: (orig: number) => number; color?: (orig: number) => [number, number, number]; alpha?: (orig: number) => number } = {}
): THREE.BufferGeometry {
  const so = base.splitOrig
  const tris = opts.tris
  // compact to the render vertices the chosen triangles use
  const map = new Int32Array(so.length).fill(-1)
  const verts: number[] = []
  const index: number[] = []
  const triCount = tris ? tris.length : base.index.length / 3
  for (let k = 0; k < triCount; k++) {
    const t = (tris ? tris[k]! : k) * 3
    for (let c = 0; c < 3; c++) {
      const sv = base.index[t + c]!
      if (map[sv]! < 0) {
        map[sv] = verts.length
        verts.push(sv)
      }
      index.push(map[sv]!)
    }
  }
  const N = verts.length
  const pos = new Float32Array(N * 3)
  const nor = new Float32Array(N * 3)
  const uv = new Float32Array(N * 2)
  const si = new Uint16Array(N * 4)
  const sw = new Float32Array(N * 4)
  // vertex colour (rgb) and, for soft-cut edges, alpha (rgba)
  const cw = opts.alpha ? 4 : 3
  const col = opts.color || opts.alpha ? new Float32Array(N * cw) : null
  for (let j = 0; j < N; j++) {
    const sv = verts[j]!
    const o = so[sv]!
    const d = opts.offset ? opts.offset(o) : 0
    for (let c = 0; c < 3; c++) {
      pos[j * 3 + c] = p[o * 3 + c]! + n[o * 3 + c]! * d
      nor[j * 3 + c] = n[o * 3 + c]!
    }
    uv[j * 2] = base.uv[sv * 2]!
    uv[j * 2 + 1] = base.uv[sv * 2 + 1]!
    for (let c = 0; c < 4; c++) {
      si[j * 4 + c] = base.skinIndex[o * 4 + c]!
      sw[j * 4 + c] = base.skinWeight[o * 4 + c]! / 255
    }
    if (col) {
      const [r, g, b] = opts.color ? opts.color(o) : [1, 1, 1]
      col[j * cw] = r
      col[j * cw + 1] = g
      col[j * cw + 2] = b
      if (opts.alpha) col[j * cw + 3] = opts.alpha(o)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, cw))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

/** The fitted eyes (skinned to the head). */
export function eyeGeometry(base: BodyBase, p: Float32Array, headBone: number): THREE.BufferGeometry {
  const e = base.eye
  const nv = e.refs.length / 3
  const sc: Record<string, number> = {}
  for (const [ax, [a, b, dist]] of Object.entries(e.scales)) {
    const c = ax === 'x' ? 0 : ax === 'y' ? 1 : 2
    sc[ax] = Math.abs(p[a * 3 + c]! - p[b * 3 + c]!) / dist // metres per MakeHuman unit
  }
  const fitted = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) {
    for (let c = 0; c < 3; c++) {
      let v = 0
      for (let r = 0; r < 3; r++) v += p[e.refs[i * 3 + r]! * 3 + c]! * e.w[i * 3 + r]!
      v += e.off[i * 3 + c]! * sc[c === 0 ? 'x' : c === 1 ? 'y' : 'z']!
      fitted[i * 3 + c] = v
    }
  }
  const N = e.orig.length
  const pos = new Float32Array(N * 3)
  for (let j = 0; j < N; j++) for (let c = 0; c < 3; c++) pos[j * 3 + c] = fitted[e.orig[j]! * 3 + c]!
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(e.uv.slice(), 2))
  g.setIndex(Array.from(e.index))
  g.computeVertexNormals()
  const si = new Uint16Array(N * 4)
  const sw = new Float32Array(N * 4)
  for (let j = 0; j < N; j++) {
    si[j * 4] = headBone
    sw[j * 4] = 1
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
  return g
}

// textures: the eye, and per gender a skin detail map (a multiplier on the
// skin colour, 0.8 = the colour itself: brows, lips, lash line, palms)
const textures = new Map<string, Promise<THREE.Texture>>()
const texReady = new Map<string, THREE.Texture>()
function texture(url: string): Promise<THREE.Texture> {
  let p = textures.get(url)
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 4
      texReady.set(url, t)
      return t
    })
    textures.set(url, p)
  }
  return p
}
const EYE_URL = '/models/human/eye_brown.webp'
const skinUrl = (g: string) => `/models/human/${g}_skin.webp`
/** Load the bodies and their textures before the first person is built. */
export const preloadHumans = () =>
  Promise.all([loadBody('male'), loadBody('female'), texture(EYE_URL), texture(skinUrl('male')), texture(skinUrl('female'))])
/** the skin colour is lifted to cancel the map's 0.8 base */
const SKIN_LIFT = 1 / 0.8

/** A person on their own skeleton: skin, eyes and (with an outfit) their
 *  clothes and hair. Returns the HumanRig shape the animators expect. */
export function buildBody(base: BodyBase, spec: BodySpec, outfit?: Outfit): HumanRig & { p: Float32Array; n: Float32Array; skeleton: THREE.Skeleton; boneIndex: Record<string, number> } {
  const p = bodyPositions(base, spec.morphs)
  const n = bodyNormals(base, p)
  const { root, bones, rest, skeleton, list } = buildSkeleton(base)
  const boneIndex: Record<string, number> = {}
  list.forEach((b, i) => (boneIndex[b.name] = i))
  const dressed = outfit ? dress(base, p, n, outfit, boneIndex, spec.skin) : null
  const disposables: Array<{ dispose(): void }> = []
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.SkinnedMesh(geo, mat)
    m.castShadow = true
    m.frustumCulled = false
    m.bind(skeleton, new THREE.Matrix4())
    root.add(m)
    disposables.push(geo, mat)
  }
  if (dressed) {
    for (const pc of dressed.pieces) add(skinnedGeometry(base, p, n, { tris: pc.tris, offset: pc.offset, color: pc.color, alpha: pc.alpha }), pc.mat)
    for (const ex of dressed.extras) add(ex.geo, ex.mat)
  }
  const skinMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.skin).multiplyScalar(SKIN_LIFT),
    map: texReady.get(skinUrl(base.gender)) ?? null,
    roughness: 0.6,
    metalness: 0
  })
  if (!skinMat.map) void texture(skinUrl(base.gender)).then((t) => ((skinMat.map = t), (skinMat.needsUpdate = true)))
  const skinGeo = skinnedGeometry(base, p, n, { tris: dressed?.skinTris })
  const skin = new THREE.SkinnedMesh(skinGeo, skinMat)
  const eyeGeo = eyeGeometry(base, p, boneIndex.head!)
  // (the cornea shell over each eye is see-through in the map's alpha)
  const eyeMat = new THREE.MeshStandardMaterial({ map: texReady.get(EYE_URL) ?? null, roughness: 0.18, metalness: 0, alphaTest: 0.5 })
  if (!eyeMat.map) void texture(EYE_URL).then((t) => ((eyeMat.map = t), (eyeMat.needsUpdate = true)))
  const eyes = new THREE.SkinnedMesh(eyeGeo, eyeMat)
  for (const m of [skin, eyes]) {
    m.castShadow = true
    m.frustumCulled = false
    m.bind(skeleton, new THREE.Matrix4())
    root.add(m)
  }
  return {
    root,
    bones,
    rest,
    p,
    n,
    skeleton,
    boneIndex,
    dispose() {
      skinGeo.dispose()
      eyeGeo.dispose()
      skinMat.dispose()
      eyeMat.dispose()
      for (const d of disposables) d.dispose()
      skeleton.dispose()
    }
  }
}
