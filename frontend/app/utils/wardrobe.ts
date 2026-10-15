// wardrobe - turns one rigged base character into many different people.
//
// 1) Body-region map: every triangle is labelled by the bone that moves it
//    (head / hands / torso+arms / legs / feet) and painted into a mask in
//    UV space, so we know which texels are the top, the trousers or skirt,
//    the shoes, the face and the hair.
// 2) Recolour: per person, skin texels are shifted to their skin tone,
//    clothing texels are re-dyed to their colours (keeping the fabric's own
//    shading, folds and print), optionally with an ankara print, and hair
//    is tinted. Variants are cached by look.
// 3) Gadgets: small props parented to bones - phone in hand, sunglasses,
//    cap / kufi / gele / hijab, headphones, backpack, sling bag, watch.
import * as THREE from 'three'

export interface Look {
  skin: string
  top: string
  bottom: string
  shoes?: string
  hair?: string
  /** ankara print on the top (0 none .. 1 bold) */
  print?: number
  gadgets?: Gadget[]
  /** the body's head is covered by cloth (hijab model): dye it with `hair` */
  headCloth?: boolean
}
export type Gadget = 'phone' | 'sunglasses' | 'cap' | 'kufi' | 'gele' | 'hijab' | 'headphones' | 'backpack' | 'bag' | 'watch'

const REGION: Array<[RegExp, number]> = [
  [/Head|Neck/, 1], // head / neck (skin + hair)
  [/Hand|Thumb|Index|Middle|Ring|Pinky/, 2], // hands
  [/Spine|Shoulder|Arm/, 3], // torso + arms (top)
  [/UpLeg|Leg$/, 4], // legs (bottom)
  [/Hips/, 6], // pelvis: top or bottom, decided by colour
  [/Foot|Toe/, 5] // feet (shoes)
]
const SIZE = 1024

export interface BaseInfo {
  img: ImageData
  labels: Uint8Array
  /** mean colour per class, used as the "reference" to re-dye from */
  ref: { skin: number[]; top: number[]; bottom: number[]; hair: number[] }
}
const bases = new WeakMap<THREE.Texture, BaseInfo>()
const variants = new Map<string, THREE.Texture>()

function regionOf(name: string): number {
  for (const [re, r] of REGION) if (re.test(name)) return r
  return 3
}

function rgb2hsv(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, mx > 0 ? d / mx : 0, mx]
}
/** typical skin: warm orange-brown hue, moderate saturation */
function isSkin(r: number, g: number, b: number) {
  const [h, s, v] = rgb2hsv(r, g, b)
  return h >= 8 && h <= 38 && s > 0.3 && s < 0.82 && v > 0.22 && r > b + 0.08
}

/** Engine-agnostic view of a skinned mesh (three or Babylon). */
export interface MeshData {
  count: number
  uv: (i: number) => [number, number]
  /** the bone index that weighs most on vertex i */
  topBone: (i: number) => number
  index: ((n: number) => number) | null
  triCount: number
  boneNames: string[]
}
function threeMeshData(mesh: THREE.SkinnedMesh): MeshData {
  const g = mesh.geometry
  const uv = g.attributes.uv
  const si = g.attributes.skinIndex
  const sw = g.attributes.skinWeight
  const idx = g.index
  return {
    count: uv.count,
    uv: (i) => [uv.getX(i), uv.getY(i)],
    topBone: (i) => {
      let best = 0
      let bw = -1
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k)
        if (w > bw) (bw = w), (best = si.getComponent(i, k))
      }
      return best
    },
    index: idx ? (n) => idx.getX(n) : null,
    triCount: idx ? idx.count / 3 : uv.count / 3,
    boneNames: mesh.skeleton.bones.map((b) => b.name)
  }
}

function buildBase(mesh: THREE.SkinnedMesh, tex: THREE.Texture, headCloth = false): BaseInfo | null {
  return buildBaseFrom(threeMeshData(mesh), tex.image as CanvasImageSource & { width: number; height: number }, headCloth)
}

export function buildBaseFrom(md: MeshData, image: CanvasImageSource & { width: number; height: number }, headCloth = false): BaseInfo | null {
  if (!image || !image.width) return null
  const cv = document.createElement('canvas')
  cv.width = cv.height = SIZE
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0, SIZE, SIZE)
  const img = ctx.getImageData(0, 0, SIZE, SIZE)

  // rasterise triangle regions into UV space
  const lab = document.createElement('canvas')
  lab.width = lab.height = SIZE
  const lc = lab.getContext('2d', { willReadFrequently: true })!
  lc.imageSmoothingEnabled = false
  const names = md.boneNames
  const vReg = new Uint8Array(md.count)
  for (let i = 0; i < md.count; i++) vReg[i] = regionOf(names[md.topBone(i)] ?? '')
  const tri = md.triCount
  const at = (n: number) => (md.index ? md.index(n) : n)
  for (let t = 0; t < tri; t++) {
    const a = at(t * 3)
    const b = at(t * 3 + 1)
    const c = at(t * 3 + 2)
    // majority region of the three corners
    const ra = vReg[a]
    const reg = ra === vReg[b] || ra === vReg[c] ? ra : vReg[b]
    lc.fillStyle = `rgb(${reg * 40},0,0)`
    lc.beginPath()
    const [ua, va] = md.uv(a)
    const [ub, vb] = md.uv(b)
    const [uc, vc] = md.uv(c)
    lc.moveTo(ua * SIZE, va * SIZE)
    lc.lineTo(ub * SIZE, vb * SIZE)
    lc.lineTo(uc * SIZE, vc * SIZE)
    lc.closePath()
    lc.fill()
    lc.lineWidth = 2
    lc.strokeStyle = lc.fillStyle
    lc.stroke() // grows each island a little so seams don't leak
  }
  const ld = lc.getImageData(0, 0, SIZE, SIZE).data
  const labels = new Uint8Array(SIZE * SIZE)
  for (let i = 0; i < labels.length; i++) labels[i] = Math.round(ld[i * 4] / 40)
  // the texture's v axis is flipped relative to the canvas (flipY=false on
  // glTF textures means uv(0,0) is the top-left, which is what we drew)

  // classify texels and gather reference colours (pelvis texels are
  // decided afterwards by which garment colour they are closer to)
  const d = img.data
  const sum = { skin: [0, 0, 0, 0], top: [0, 0, 0, 0], bottom: [0, 0, 0, 0], hair: [0, 0, 0, 0] }
  const pelvis: number[] = []
  for (let i = 0; i < labels.length; i++) {
    const reg = labels[i]
    if (!reg) continue
    const r = d[i * 4] / 255
    const gg = d[i * 4 + 1] / 255
    const bb = d[i * 4 + 2] / 255
    const v = Math.max(r, gg, bb)
    let cls: keyof typeof sum | null = null
    // legs and feet are covered (trousers / leggings / shoes): no skin there
    if (reg !== 4 && reg !== 5 && isSkin(r, gg, bb)) cls = 'skin'
    else if (reg === 1 && headCloth) cls = 'hair' // hijab: the head cloth takes the 'hair' colour
    else if (reg === 1 || reg === 2) cls = v < 0.3 ? 'hair' : null
    else if (reg === 3) cls = 'top'
    else if (reg === 4) cls = 'bottom'
    else if (reg === 6) {
      pelvis.push(i)
      continue
    }
    if (!cls) continue
    // store class in the label's high bits: 1 skin, 2 top, 3 bottom, 4 hair
    labels[i] = reg | ((cls === 'skin' ? 1 : cls === 'top' ? 2 : cls === 'bottom' ? 3 : 4) << 4)
    const s = sum[cls]
    s[0] += r
    s[1] += gg
    s[2] += bb
    s[3]++
  }
  {
    const m = (s: number[]) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0.5, 0.5, 0.5])
    const tRef = m(sum.top)
    const bRef = m(sum.bottom)
    for (const i of pelvis) {
      const c = [d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255]
      const dt = (c[0] - tRef[0]) ** 2 + (c[1] - tRef[1]) ** 2 + (c[2] - tRef[2]) ** 2
      const db = (c[0] - bRef[0]) ** 2 + (c[1] - bRef[1]) ** 2 + (c[2] - bRef[2]) ** 2
      labels[i] = 6 | ((isSkin(c[0], c[1], c[2]) ? 1 : dt < db ? 2 : 3) << 4)
    }
  }
  const mean = (s: number[]) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0.5, 0.5, 0.5])
  return { img, labels, ref: { skin: mean(sum.skin), top: mean(sum.top), bottom: mean(sum.bottom), hair: mean(sum.hair) } }
}

const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
function hex(c: string): number[] {
  const col = new THREE.Color(c)
  col.convertLinearToSRGB()
  return [col.r, col.g, col.b]
}
function ankara(x: number, y: number): number {
  // bold wax-print rhythm: concentric rings on a diagonal lattice
  const u = (x + y) * 0.035
  const v = (x - y) * 0.035
  const fu = u - Math.floor(u) - 0.5
  const fv = v - Math.floor(v) - 0.5
  const r = Math.sqrt(fu * fu + fv * fv)
  return Math.sin(r * 38) > 0.2 ? 1 : 0
}

/** A recoloured copy of the character's texture for this look (cached). */
export function dressTexture(mesh: THREE.SkinnedMesh, tex: THREE.Texture, look: Look): THREE.Texture {
  const key = `${tex.uuid}|${look.skin}|${look.top}|${look.bottom}|${look.hair ?? ''}|${look.print ?? 0}`
  const hit = variants.get(key)
  if (hit) return hit
  let base = bases.get(tex)
  if (!base) {
    const b = buildBase(mesh, tex, !!look.headCloth)
    if (!b) return tex
    base = b
    bases.set(tex, base)
  }
  const cv = dressCanvas(base, look)
  const t = new THREE.CanvasTexture(cv)
  t.flipY = tex.flipY
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  variants.set(key, t)
  return t
}

/** Re-dye a base texture for a look; returns a canvas (any engine). */
export function dressCanvas(base: BaseInfo, look: Look): HTMLCanvasElement {
  const out = new ImageData(new Uint8ClampedArray(base.img.data), SIZE, SIZE)
  const d = out.data
  const L = base.labels
  const skinT = hex(look.skin)
  const topT = hex(look.top)
  const botT = hex(look.bottom)
  const hairT = look.hair ? hex(look.hair) : null
  const kSkin = [skinT[0] / Math.max(0.05, base.ref.skin[0]), skinT[1] / Math.max(0.05, base.ref.skin[1]), skinT[2] / Math.max(0.05, base.ref.skin[2])]
  const lTop = lum(base.ref.top) || 0.3
  const lBot = lum(base.ref.bottom) || 0.3
  const print = look.print ?? 0
  const printC = [1 - topT[0] * 0.6, 0.85 - topT[1] * 0.4, 0.3 + topT[2] * 0.3]
  for (let i = 0; i < L.length; i++) {
    const cls = L[i] >> 4
    if (!cls) continue
    const j = i * 4
    const r = d[j] / 255
    const g = d[j + 1] / 255
    const b = d[j + 2] / 255
    let o: number[]
    if (cls === 1) {
      o = [r * kSkin[0], g * kSkin[1], b * kSkin[2]]
    } else if (cls === 2 || cls === 3) {
      // re-dye: keep the fabric's shading relative to its average
      const t = cls === 2 ? topT : botT
      // keep folds and print, but not blotches: shading within a sane band
      const shade = Math.min(1.35, Math.max(0.55, lum([r, g, b]) / (cls === 2 ? lTop : lBot)))
      o = [t[0] * shade, t[1] * shade, t[2] * shade]
      if (cls === 2 && print > 0 && ankara(i % SIZE, Math.floor(i / SIZE))) {
        o = [o[0] + (printC[0] * shade - o[0]) * print, o[1] + (printC[1] * shade - o[1]) * print, o[2] + (printC[2] * shade - o[2]) * print]
      }
    } else if (cls === 4 && hairT) {
      const shade = lum([r, g, b]) / Math.max(0.03, lum(base.ref.hair))
      o = [hairT[0] * shade, hairT[1] * shade, hairT[2] * shade]
    } else continue
    d[j] = Math.min(255, o[0] * 255)
    d[j + 1] = Math.min(255, o[1] * 255)
    d[j + 2] = Math.min(255, o[2] * 255)
  }
  const cv = document.createElement('canvas')
  cv.width = cv.height = SIZE
  cv.getContext('2d')!.putImageData(out, 0, 0)
  return cv
}

// ------------------------------------------------------------------ gadgets
const mat = (c: string, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal })
function part(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, m)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  return mesh
}

/** Build a prop in metres (+Y up, +Z forward, as worn on a 1.75 m body). */
function buildGadget(g: Gadget, look: Look): THREE.Object3D {
  const o = new THREE.Group()
  switch (g) {
    case 'phone': {
      const body = part(new THREE.BoxGeometry(0.075, 0.15, 0.009), mat('#16181c', 0.3, 0.4))
      const screen = part(new THREE.PlaneGeometry(0.066, 0.138), new THREE.MeshBasicMaterial({ color: '#3d7bd8' }), 0, 0, 0.0055)
      o.add(body, screen)
      break
    }
    case 'sunglasses': {
      const m = mat('#0d0f12', 0.15, 0.3)
      for (const s of [-1, 1]) o.add(part(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 16).rotateX(Math.PI / 2), m, s * 0.034, 0, 0))
      o.add(part(new THREE.BoxGeometry(0.02, 0.004, 0.004), m, 0, 0.006, 0))
      for (const s of [-1, 1]) o.add(part(new THREE.BoxGeometry(0.004, 0.004, 0.1), m, s * 0.062, 0.004, -0.05))
      break
    }
    case 'cap': {
      const m = mat(look.bottom === look.top ? '#c43b2e' : look.top, 0.8)
      const crown = new THREE.SphereGeometry(0.118, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
      o.add(part(crown, m))
      o.add(part(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 20, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.25), m, 0, 0.005, 0.1))
      break
    }
    case 'kufi': {
      const m = mat('#efe8d6', 0.85)
      o.add(part(new THREE.CylinderGeometry(0.108, 0.112, 0.08, 24, 1, true), m, 0, 0.03, 0))
      o.add(part(new THREE.CircleGeometry(0.108, 24).rotateX(-Math.PI / 2), m, 0, 0.07, 0))
      break
    }
    case 'gele': {
      const m = mat(look.top, 0.55)
      const wrap = new THREE.TorusKnotGeometry(0.075, 0.035, 48, 8, 2, 3)
      wrap.scale(1.15, 0.85, 1.05)
      o.add(part(wrap, m, 0, 0.05, -0.01))
      break
    }
    case 'hijab': {
      const m = new THREE.MeshStandardMaterial({ color: look.bottom, roughness: 0.85, side: THREE.DoubleSide })
      // hood over the hair, open at the front to frame the face
      const hood = new THREE.SphereGeometry(0.17, 26, 16, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.72)
      hood.scale(1, 1.1, 1.05)
      o.add(part(hood, m, 0, 0, -0.02))
      // drape over the neck and shoulders
      const drape = new THREE.CylinderGeometry(0.13, 0.22, 0.22, 26, 1, true)
      o.add(part(drape, m, 0, -0.2, -0.02))
      break
    }
    case 'headphones': {
      const m = mat('#1b1d22', 0.4, 0.2)
      o.add(part(new THREE.TorusGeometry(0.1, 0.012, 8, 24, Math.PI), m, 0, 0.02, 0))
      for (const s of [-1, 1]) o.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16).rotateZ(Math.PI / 2), m, s * 0.1, 0.0, 0))
      break
    }
    case 'backpack': {
      const m = mat('#2b3440', 0.85)
      const bag = new THREE.BoxGeometry(0.3, 0.4, 0.14)
      o.add(part(bag, m, 0, 0, -0.17))
      o.add(part(new THREE.BoxGeometry(0.24, 0.16, 0.05), mat('#3a4656', 0.85), 0, -0.08, -0.255))
      break
    }
    case 'bag': {
      const m = mat('#7a4a2a', 0.6)
      o.add(part(new THREE.BoxGeometry(0.06, 0.2, 0.26), m, 0, -0.15, 0))
      break
    }
    case 'watch': {
      o.add(part(new THREE.TorusGeometry(0.03, 0.007, 6, 16).rotateY(Math.PI / 2), mat('#1a1a1a', 0.5)))
      o.add(part(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 16).rotateZ(Math.PI / 2), mat('#c8ccd2', 0.25, 0.9), 0.032, 0, 0))
      break
    }
  }
  return o
}

/** Where each gadget sits: bone + offset (metres, body space). */
const MOUNT: Record<Gadget, { bone: string; pos: [number, number, number]; rot?: [number, number, number] }> = {
  phone: { bone: 'RightHand', pos: [0, 0.07, 0.03], rot: [0.3, 0, 0] },
  sunglasses: { bone: 'Head', pos: [0, 0.11, 0.1] },
  cap: { bone: 'Head', pos: [0, 0.18, 0.0] },
  kufi: { bone: 'Head', pos: [0, 0.17, -0.005] },
  gele: { bone: 'Head', pos: [0, 0.22, -0.01] },
  hijab: { bone: 'Head', pos: [0, 0.12, -0.005] },
  headphones: { bone: 'Head', pos: [0, 0.12, -0.01] },
  backpack: { bone: 'Spine2', pos: [0, 0.0, 0] },
  bag: { bone: 'Spine2', pos: [0.17, 0.0, 0] },
  watch: { bone: 'LeftForeArm', pos: [0, 0.22, 0] }
}

const tmpS = new THREE.Vector3()
/** Attach gadgets to the bones; props are sized in metres whatever the
 *  rig's own units by cancelling the bone's world scale. */
export function wearGadgets(root: THREE.Object3D, bones: Record<string, THREE.Bone>, look: Look): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  root.updateMatrixWorld(true)
  const rootScale = root.getWorldScale(new THREE.Vector3()).y || 1
  for (const g of look.gadgets ?? []) {
    const m = MOUNT[g]
    const bone = bones[m.bone]
    if (!bone) continue
    const obj = buildGadget(g, look)
    bone.getWorldScale(tmpS)
    const k = rootScale / (tmpS.y || 1)
    obj.scale.setScalar(k)
    obj.position.set(m.pos[0] * k, m.pos[1] * k, m.pos[2] * k)
    if (m.rot) obj.rotation.set(...m.rot)
    bone.add(obj)
    out.push(obj)
  }
  return out
}

// ------------------------------------------------------------------ looks
const SKINS = ['#3a2216', '#4a2a18', '#5a3420', '#6e4630', '#7a4e33', '#8a5a3a', '#9c6a46', '#b07a52']
const TOPS = ['#2e7d5b', '#3f6fae', '#b8392e', '#e0b13a', '#efe8d6', '#7a4a8a', '#1f2a44', '#c46a2a', '#2b2b2f', '#d86a8a', '#3a7d8a', '#8a6a3a', '#f2f2f0', '#6a8a2a', '#a83a6a', '#2a5a3a']
const BOTTOMS = ['#2b3440', '#1d1f24', '#4a3a2a', '#efe8d6', '#2e4a6e', '#5a5a5e', '#c9b78e', '#3a3a2a', '#7a2a2a', '#2f5fa8']
const HAIRS = ['#141114', '#141114', '#141114', '#2a1a10', '#3a2414', '#6b3e1e', '#9a6a2a', '#7a7a7a']

/** A deterministic everyday look for person #id (crowd / NPCs). */
export function lookFor(id: number, female: boolean): Look {
  const h = (k: number) => {
    const x = Math.sin(id * 127.1 + k * 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  const pick = <T>(a: T[], k: number) => a[Math.floor(h(k) * a.length) % a.length]
  const gadgets: Gadget[] = []
  if (female) {
    const r = h(5)
    if (r < 0.3) gadgets.push('hijab')
    else if (r < 0.5) gadgets.push('gele')
  } else {
    const r = h(5)
    if (r < 0.28) gadgets.push('kufi')
    else if (r < 0.42) gadgets.push('cap')
  }
  if (h(6) < 0.35) gadgets.push('phone')
  if (h(7) < 0.18 && !gadgets.includes('hijab')) gadgets.push('sunglasses')
  if (h(8) < 0.2) gadgets.push(female ? 'bag' : 'backpack')
  if (h(9) < 0.3) gadgets.push('watch')
  if (h(10) < 0.08 && !gadgets.some((g) => g === 'hijab' || g === 'gele')) gadgets.push('headphones')
  return {
    skin: pick(SKINS, 1),
    hair: pick(HAIRS, 12),
    top: pick(TOPS, 2),
    bottom: pick(BOTTOMS, 3),
    print: h(4) < (female ? 0.45 : 0.25) ? 0.55 + h(11) * 0.35 : 0,
    gadgets
  }
}

// ------------------------------------------------------- painted outfits
// Characters that arrive without a texture (kaftan man, hijab woman) are
// painted here, per person, straight into their UV layout: every triangle
// is classified from the rest pose (face / hair / hands / robe / veil /
// sandals) and filled with that person's colours plus soft shading,
// fabric grain and an embroidered placket on the kaftan.
export type PaintKind = 'caftan' | 'hijab'
const painted = new Map<string, THREE.Texture>()

export function paintOutfit(mesh: THREE.SkinnedMesh, kind: PaintKind, look: Look): THREE.Texture {
  const key = `${mesh.geometry.uuid}|${kind}|${look.skin}|${look.top}|${look.bottom}|${look.print ?? 0}`
  const hit = painted.get(key)
  if (hit) return hit
  const g = mesh.geometry
  const pos = g.attributes.position
  const nrm = g.attributes.normal
  const uv = g.attributes.uv
  const si = g.attributes.skinIndex
  const sw = g.attributes.skinWeight
  const idx = g.index
  const bones = mesh.skeleton.bones
  const names = bones.map((b) => b.name)
  // rest-pose bone positions in mesh space
  const restPos = (name: string) => {
    const i = names.indexOf(name)
    if (i < 0) return null
    const m = mesh.skeleton.boneInverses[i].clone().invert()
    return new THREE.Vector3().setFromMatrixPosition(m)
  }
  // work in bind space (where the bones live): geometry * bindMatrix
  const BM = mesh.bindMatrix
  const NM = new THREE.Matrix3().getNormalMatrix(BM)
  const bb = new THREE.Box3()
  const pv = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) bb.expandByPoint(pv.fromBufferAttribute(pos, i).applyMatrix4(BM))
  const H = bb.max.y - bb.min.y
  const head = restPos('Head') ?? new THREE.Vector3(0, bb.max.y - 0.12 * H, 0)
  const reg = new Uint8Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    let best = 0
    let bw = -1
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k)
      if (w > bw) {
        bw = w
        best = si.getComponent(i, k)
      }
    }
    reg[i] = regionOf(names[best] ?? '')
  }
  // which way does this body face? toes point forward from the ankles
  const F = new THREE.Vector3()
  for (const side of ['Left', 'Right']) {
    const foot = restPos(`${side}Foot`)
    const toe = restPos(`${side}ToeBase`)
    if (foot && toe) F.add(toe.sub(foot))
  }
  F.y = 0
  if (F.lengthSq() < 1e-12) F.set(0, 0, 1)
  F.normalize()
  const SIDE = new THREE.Vector3(0, 1, 0).cross(F).normalize()
  const skinC = new THREE.Color(look.skin)
  const robeC = new THREE.Color(look.top)
  const veilC = new THREE.Color(kind === 'hijab' ? look.bottom : '#151214')
  const shoeC = new THREE.Color('#4a3424')
  const trimC = new THREE.Color(look.top).lerp(new THREE.Color('#f1d27a'), 0.75)
  const lipC = new THREE.Color(look.skin).multiplyScalar(0.7).lerp(new THREE.Color('#7a3a3a'), 0.3)
  const S = 1024
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = `#${robeC.clone().multiplyScalar(0.85).getHexString()}`
  ctx.fillRect(0, 0, S, S)
  const tri = idx ? idx.count / 3 : pos.count / 3
  const at = (n: number) => (idx ? idx.getX(n) : n)
  let dbgFace = 0
  let dbgHead = 0
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const col = new THREE.Color()
  const fills: string[] = new Array(tri)
  for (let t = 0; t < tri; t++) {
    const a = at(t * 3)
    const b = at(t * 3 + 1)
    const d = at(t * 3 + 2)
    c.set(0, 0, 0)
    n.set(0, 0, 0)
    for (const v of [a, b, d]) {
      c.add(tmp.fromBufferAttribute(pos, v).applyMatrix4(BM))
      n.add(tmp.fromBufferAttribute(nrm, v).applyMatrix3(NM))
    }
    c.multiplyScalar(1 / 3)
    n.normalize()
    const r = reg[a] === reg[b] || reg[a] === reg[d] ? reg[a] : reg[b]
    const rel = c.clone().sub(head)
    const yH = rel.y / H
    const xH = Math.abs(rel.dot(SIDE)) / H
    const zH = rel.dot(F) / H
    // the Head bone sits at the jaw: the face spans ~0..0.105 H above it
    const frontFace = zH > 0.03 && n.dot(F) > 0.3 && xH < 0.045 && yH > -0.045 && yH < 0.1
    let shade = 1
    if (frontFace) dbgFace++
    if (r === 1) dbgHead++
    if (r === 2) col.copy(skinC)
    else if (r === 5) col.copy(shoeC)
    else if (r === 1) {
      if (frontFace) {
        col.copy(skinC)
        // the sculpt carries the eyes and brows; just warm the lips
        if (yH > -0.012 && yH < 0.004 && xH < 0.013) col.copy(lipC)
      } else if (kind === 'hijab') col.copy(veilC)
      else if (yH > 0.1 && n.y > 0.1) col.set('#141114') // close-cut hair
      else col.copy(skinC)
    } else {
      // body: robe / abaya; the hijab drape covers neck + shoulders
      if (kind === 'hijab' && yH > -0.12) col.copy(veilC)
      else col.copy(robeC)
      // kaftan: embroidered placket down the chest + hem/cuff trim
      if (kind === 'caftan' && zH > 0 && xH < 0.016 && yH < -0.06 && yH > -0.3) col.copy(trimC)
      if (kind === 'caftan' && xH < 0.04 && yH < -0.03 && yH > -0.06 && zH > 0.0) col.copy(trimC)
    }
    // soft top-light shading baked in (folds read even in flat light)
    shade = 0.82 + 0.18 * Math.max(0, n.y * 0.6 + 0.6)
    fills[t] = `rgb(${Math.min(255, col.r * 255 * shade) | 0},${Math.min(255, col.g * 255 * shade) | 0},${Math.min(255, col.b * 255 * shade) | 0})`
  }
  // pass 1 grows every island (seams), pass 2 paints exact interiors so a
  // neighbour's growth never covers a small region like the face
  for (const pass of [0, 1]) {
    for (let t = 0; t < tri; t++) {
      const a = at(t * 3)
      const b = at(t * 3 + 1)
      const d = at(t * 3 + 2)
      ctx.fillStyle = fills[t]
      ctx.beginPath()
      ctx.moveTo(uv.getX(a) * S, uv.getY(a) * S)
      ctx.lineTo(uv.getX(b) * S, uv.getY(b) * S)
      ctx.lineTo(uv.getX(d) * S, uv.getY(d) * S)
      ctx.closePath()
      ctx.fill()
      if (pass === 0) {
        ctx.strokeStyle = fills[t]
        ctx.lineWidth = 4
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
    }
  }
  void dbgHead
  void dbgFace
  // fabric grain over everything (subtle)
  const img = ctx.getImageData(0, 0, S, S)
  const px = img.data
  let seed = 1337
  for (let i = 0; i < px.length; i += 4) {
    seed = (seed * 16807) % 2147483647
    const k = 0.94 + (seed / 2147483647) * 0.1
    px[i] = Math.min(255, px[i] * k)
    px[i + 1] = Math.min(255, px[i + 1] * k)
    px[i + 2] = Math.min(255, px[i + 2] * k)
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  painted.set(key, tex)
  return tex
}
