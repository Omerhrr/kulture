// mixamo - real, motion-captured characters (Mixamo rig) for Kaduna Kulture.
// Characters live in /models/mixamo/<name>.glb, animations (skinless, one
// clip each) in /models/mixamo/anims/<clip>.glb. Everything is loaded once
// and cached; each avatar gets its own SkeletonUtils clone + mixer.
// Track names are normalised (the "mixamorig:" prefix stripped on bones
// and tracks) so any Mixamo clip drives any Mixamo character, and root
// motion is removed from locomotion clips (the game moves the body).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

export const MIXAMO_CLIPS = [
  'idle',
  'idle_2',
  'idle_3',
  'walking',
  'running',
  'jumping_up',
  'punching',
  'drop_kick',
  'zombie_stand_up',
  'hard_landing',
  'falling_idle',
  'run_to_stop'
] as const
export type MixamoClip = (typeof MIXAMO_CLIPS)[number]

export type MixamoCharacter = 'arissa' | 'african_male' | 'african_female' | 'caftan_male' | 'hijab_female'
/** the default real character per build */
// Kaduna's own residents (Blender -> Mixamo auto-rig); each person gets
// their own clothes, skin tone and gadgets from utils/wardrobe
export const REAL_CHARACTERS: Partial<Record<'female' | 'male' | 'caftan' | 'hijab', MixamoCharacter>> = {
  female: 'african_female',
  male: 'african_male',
  // traditional dress (your Blender designs, Mixamo-rigged)
  caftan: 'caftan_male',
  hijab: 'hijab_female'
}

/** Characters rigged outside Mixamo (Blender/Tripo 17-bone armature): the
 *  Mixamo clips play on a hidden Mixamo skeleton (Arissa's) and are
 *  retargeted bone-by-bone onto this rig every frame. */
const RETARGET: Partial<Record<MixamoCharacter, Record<string, string>>> = {
  // (none right now: african_* are Mixamo-rigged; keep for future
  // Blender-rigged characters)
}
void TRIPO_MAP
function TRIPO_MAP(): Record<string, string> {
  return {
    root: 'Hips',
    spine: 'Spine',
    chest: 'Spine2',
    neck: 'Neck',
    head: 'Head',
    'upper_armL': 'LeftArm',
    'forearmL': 'LeftForeArm',
    'handL': 'LeftHand',
    'upper_armR': 'RightArm',
    'forearmR': 'RightForeArm',
    'handR': 'RightHand',
    'thighL': 'LeftUpLeg',
    'shinL': 'LeftLeg',
    'footL': 'LeftFoot',
    'thighR': 'RightUpLeg',
    'shinR': 'RightLeg',
    'footR': 'RightFoot'
  }
}
/** street height for retargeted characters (metres) */
const TARGET_HEIGHT = { african_male: 1.78, african_female: 1.66, caftan_male: 1.8, hijab_female: 1.66 } as Record<string, number>

const BASE = '/models/mixamo'
const loader = new GLTFLoader()
// GLTFLoader sanitises 'mixamorig:Hips' to 'mixamorigHips'; handle both
const strip = (n: string) => n.replace(/^.*:/, '').replace(/^mixamorig\d*/, '')

const models = new Map<string, Promise<THREE.Object3D>>()
let clipsP: Promise<Record<string, THREE.AnimationClip>> | null = null

function loadModel(name: MixamoCharacter): Promise<THREE.Object3D> {
  let p = models.get(name)
  if (!p) {
    p = loader.loadAsync(`${BASE}/${name}.glb`).then((g) => {
      const root = g.scene
      root.traverse((o: any) => {
        o.name = strip(o.name)
        // street clothes only: no fantasy weapons on Kaduna's streets
        if (/weapon/i.test(o.name)) o.visible = false
        if (o.isMesh) {
          o.castShadow = true
          o.receiveShadow = true
          o.frustumCulled = false
          const m = o.material as THREE.MeshStandardMaterial
          if (m) {
            m.envMapIntensity = 0.8
            if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.55)
          }
        }
      })
      return root
    })
    models.set(name, p)
  }
  return p
}

/** In-place: drop the horizontal travel of the hips (keep the bob). */
function stripRootMotion(clip: THREE.AnimationClip) {
  for (const t of clip.tracks) {
    if (t.name === 'Hips.position') {
      const v = t.values
      const x0 = v[0]
      const z0 = v[2]
      for (let i = 0; i < v.length; i += 3) {
        v[i] = x0
        v[i + 2] = z0
      }
    }
  }
}

export function loadClips(): Promise<Record<string, THREE.AnimationClip>> {
  if (!clipsP) {
    clipsP = Promise.all(
      MIXAMO_CLIPS.map((c) =>
        loader
          .loadAsync(`${BASE}/anims/${c}.glb`)
          .then((g) => {
            const clip = g.animations[0]
            if (!clip) return null
            clip.name = c
            for (const t of clip.tracks) {
              const dot = t.name.lastIndexOf('.')
              t.name = strip(t.name.slice(0, dot)) + t.name.slice(dot)
            }
            // locomotion / idles loop in place; one-shots keep their travel
            // only vertically (a kick must not slide the body away)
            stripRootMotion(clip)
            return clip
          })
          .catch(() => null)
      )
    ).then((list) => {
      const out: Record<string, THREE.AnimationClip> = {}
      for (const c of list) if (c) out[c.name] = c
      return out
    })
  }
  return clipsP
}

export interface MixamoInstance {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  clips: Record<string, THREE.AnimationClip>
  /** the (Mixamo) bones the clips drive - pose overrides go here */
  bones: Record<string, THREE.Bone>
  /** copy the driver pose onto the visible rig (retargeted characters) */
  sync?: () => void
}

function cloneWithOwnMaterials(src: THREE.Object3D): THREE.Object3D {
  const root = cloneSkinned(src)
  root.traverse((o: any) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m: any) => m.clone()) : o.material.clone()
  })
  return root
}
function boneMap(root: THREE.Object3D): Record<string, THREE.Bone> {
  const bones: Record<string, THREE.Bone> = {}
  root.traverse((o: any) => {
    if (o.isBone) bones[o.name] = o
  })
  return bones
}

/** model-space rotation of a node (product of locals up to, excluding, top) */
function modelQ(o: THREE.Object3D, top: THREE.Object3D, out: THREE.Quaternion) {
  out.identity()
  let n: THREE.Object3D | null = o
  while (n && n !== top) {
    out.premultiply(n.quaternion)
    n = n.parent
  }
  return out
}
function modelM(o: THREE.Object3D, top: THREE.Object3D, out: THREE.Matrix4) {
  out.identity()
  let n: THREE.Object3D | null = o
  while (n && n !== top) {
    n.updateMatrix()
    out.premultiply(n.matrix)
    n = n.parent
  }
  return out
}

function makeRetarget(driver: THREE.Object3D, target: THREE.Object3D, map: Record<string, string>, top: THREE.Object3D, ratio: number) {
  const dB = boneMap(driver)
  const tB = boneMap(target)
  const pairs: Array<{ t: THREE.Bone; s: THREE.Bone; sRest: THREE.Quaternion; tRest: THREE.Quaternion; depth: number }> = []
  const q = new THREE.Quaternion()
  for (const [tn, sn] of Object.entries(map)) {
    const t = tB[tn]
    const s = dB[sn]
    if (!t || !s) continue
    let depth = 0
    for (let n: any = t; n && n !== target; n = n.parent) depth++
    pairs.push({ t, s, sRest: modelQ(s, driver, new THREE.Quaternion()), tRest: modelQ(t, top, new THREE.Quaternion()), depth })
  }
  pairs.sort((a, b) => a.depth - b.depth)
  const hips = pairs.find((p) => map[p.t.name] === 'Hips')
  const m = new THREE.Matrix4()
  const sRestPos = hips ? new THREE.Vector3().setFromMatrixPosition(modelM(hips.s, driver, m)) : new THREE.Vector3()
  const tRestPos = hips ? new THREE.Vector3().setFromMatrixPosition(modelM(hips.t, top, m)) : new THREE.Vector3()
  const want = new THREE.Quaternion()
  const parentQ = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const pm = new THREE.Matrix4()
  return () => {
    for (const p of pairs) {
      // world-space delta from the driver's rest, applied on our rest
      modelQ(p.s, driver, q)
      want.copy(q).multiply(p.sRest.clone().invert()).multiply(p.tRest)
      modelQ(p.t.parent!, top, parentQ)
      p.t.quaternion.copy(parentQ.invert().multiply(want))
    }
    if (hips) {
      pos.setFromMatrixPosition(modelM(hips.s, driver, m)).sub(sRestPos).multiplyScalar(ratio).add(tRestPos)
      modelM(hips.t.parent!, top, pm)
      hips.t.position.copy(pos.applyMatrix4(pm.invert()))
    }
  }
}

export async function createMixamo(name: MixamoCharacter): Promise<MixamoInstance> {
  const map = RETARGET[name]
  if (!map) {
    const [src, clips] = await Promise.all([loadModel(name), loadClips()])
    const model = cloneWithOwnMaterials(src)
    const bones = boneMap(model)
    // characters rigged at a different unit scale (e.g. metres read as cm)
    // get their own copy of the clips with the hip travel rescaled, and the
    // whole body scaled to a real street height
    const wrap = new THREE.Group()
    wrap.add(model)
    const hips = bones.Hips
    const restY = hips ? new THREE.Vector3().setFromMatrixPosition(modelM(hips, model, new THREE.Matrix4())).y : 1
    const ref = clips.idle?.tracks.find((t) => t.name === 'Hips.position')
    const clipY = ref ? ref.values[1] : 1
    let useClips = clips
    if (hips && Math.abs(restY / clipY - 1) > 0.15) {
      const k = (hips.parent ? new THREE.Vector3().setFromMatrixScale(modelM(hips.parent, model, new THREE.Matrix4())).y : 1) || 1
      const scaleBy = restY / clipY / k
      useClips = {}
      for (const [n, c] of Object.entries(clips)) {
        const cc = c.clone()
        for (const t of cc.tracks) if (t.name === 'Hips.position') for (let i = 0; i < t.values.length; i++) t.values[i] *= scaleBy
        useClips[n] = cc
      }
    }
    if (TARGET_HEIGHT[name]) {
      model.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(model, true)
      const h = box.max.y - box.min.y
      if (h > 0.001) {
        const k = TARGET_HEIGHT[name] / h
        model.scale.multiplyScalar(k)
        model.position.y -= box.min.y * k
      }
    }
    return { root: wrap, mixer: new THREE.AnimationMixer(model), clips: useClips, bones }
  }
  // retargeted: visible character + hidden Mixamo driver skeleton
  const [src, driverSrc, clips] = await Promise.all([loadModel(name), loadModel('arissa'), loadClips()])
  const visible = cloneWithOwnMaterials(src)
  const driver = cloneSkinned(driverSrc)
  // normalise height (generated models come in at arbitrary scale)
  const wrap = new THREE.Group()
  wrap.add(visible)
  // generated models face +X; the game (and Mixamo) face +Z
  visible.rotation.y = -Math.PI / 2
  wrap.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(visible, true)
  const h = box.max.y - box.min.y
  const k = h > 0.01 ? (TARGET_HEIGHT[name] ?? 1.75) / h : 1
  visible.scale.multiplyScalar(k)
  visible.position.y -= box.min.y * k
  wrap.updateMatrixWorld(true)
  driver.updateMatrixWorld(true)
  const dBox = new THREE.Box3().setFromObject(driver, true)
  const dh = dBox.max.y - dBox.min.y || 1.7
  const sync = makeRetarget(driver, visible, map, wrap, (TARGET_HEIGHT[name] ?? 1.75) / dh)
  return { root: wrap, mixer: new THREE.AnimationMixer(driver), clips, bones: boneMap(driver), sync }
}

/** Kick off loading early (title screen) so avatars pop in quickly. */
export function preloadMixamo() {
  if (typeof window === 'undefined') return
  void loadClips()
  for (const c of Object.values(REAL_CHARACTERS)) if (c) void loadModel(c)
}
