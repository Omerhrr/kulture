// poses - what people DO: activity poses layered on top of the mocap clips
// for a Mixamo skeleton. Limbs are aimed in body space (+Z forward, +Y up,
// +X the person's left), so the same pose works on any Mixamo character
// whatever its bones' local axes. Each activity is a function of time that
// returns limb aims, a spine bend and how the body sits on the ground.
import * as THREE from 'three'

export type Activity =
  | 'pray' // salah cycle: stand, bow, prostrate, sit
  | 'worship' // hands raised, swaying
  | 'lift' // dumbbell curls
  | 'run' // treadmill / jogging
  | 'type' // seated at a desk
  | 'talk' // standing conversation
  | 'dance'
  | 'browse' // looking at shelves
  | 'cook' // working a stove / counter
  | 'serve' // waiter / bar staff
  | 'drink' // seated, sipping
  | 'watch' // seated, eyes front (cinema / TV)
  | 'clean' // sweeping
  | 'read' // seated with a book / phone
  | 'kneel' // sitting on the heels

type V = [number, number, number]
export interface PoseSpec {
  /** limb aims (body space); missing limbs keep the mocap */
  aims?: Partial<Record<'LArm' | 'LFore' | 'RArm' | 'RFore' | 'LThigh' | 'LShin' | 'RThigh' | 'RShin', V>>
  /** forward bend of the spine (radians, split over the three spine bones) */
  bend?: number
  /** head turn (yaw, radians) and nod (pitch) */
  look?: [number, number]
  /** 'seat': hips on a seat of given height, 'ground': lowest point on the floor */
  base?: 'seat' | 'ground' | 'stand'
  /** sideways hip sway (dancing) */
  sway?: number
  /** base clip override (locomotion activities) */
  clip?: 'running' | 'walking' | 'idle_2'
}

const L = (v: V): V => v
const smooth = (t: number) => t * t * (3 - 2 * t)
const lerpV = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

const SIT_LEGS = { LThigh: L([0.08, -0.05, 1]), RThigh: L([-0.08, -0.05, 1]), LShin: L([0.02, -1, 0.05]), RShin: L([-0.02, -1, 0.05]) }
const KNEEL_LEGS = { LThigh: L([0.1, -0.15, 1]), RThigh: L([-0.1, -0.15, 1]), LShin: L([0.02, -0.05, -1]), RShin: L([-0.02, -0.05, -1]) }
const PROSTRATE_LEGS = { LThigh: L([0.1, -1, 0.25]), RThigh: L([-0.1, -1, 0.25]), LShin: L([0.02, -0.05, -1]), RShin: L([-0.02, -0.05, -1]) }

/** Salah: qiyam -> ruku -> sujood -> jalsa -> sujood -> qiyam (16 s). */
function prayPose(t: number): PoseSpec {
  const c = t % 16
  const qiyam: PoseSpec = { aims: { LArm: [0.1, -0.7, 0.55], LFore: [-0.5, 0.1, 0.6], RArm: [-0.1, -0.7, 0.55], RFore: [0.5, 0.1, 0.6] }, look: [0, 0.3], base: 'stand' }
  const ruku: PoseSpec = { bend: 1.45, aims: { LArm: [0.1, -1, 0.35], LFore: [0.05, -1, 0.1], RArm: [-0.1, -1, 0.35], RFore: [-0.05, -1, 0.1] }, base: 'stand' }
  const sujood: PoseSpec = { bend: 1.9, aims: { ...PROSTRATE_LEGS, LArm: [0.25, -0.6, 0.8], LFore: [0.1, -1, 0.15], RArm: [-0.25, -0.6, 0.8], RFore: [-0.1, -1, 0.15] }, base: 'ground' }
  const jalsa: PoseSpec = { bend: 0.1, aims: { ...KNEEL_LEGS, LArm: [0.15, -1, 0.3], LFore: [0.05, -0.2, 1], RArm: [-0.15, -1, 0.3], RFore: [-0.05, -0.2, 1] }, base: 'ground' }
  const seq: Array<[number, PoseSpec]> = [
    [0, qiyam],
    [4, qiyam],
    [5, ruku],
    [7, ruku],
    [8.2, sujood],
    [10, sujood],
    [10.8, jalsa],
    [12, jalsa],
    [12.8, sujood],
    [14.5, sujood],
    [15.5, qiyam],
    [16, qiyam]
  ]
  for (let i = 0; i < seq.length - 1; i++) {
    const [t0, a] = seq[i]
    const [t1, b] = seq[i + 1]
    if (c >= t0 && c <= t1) return blend(a, b, t1 > t0 ? smooth((c - t0) / (t1 - t0)) : 0)
  }
  return qiyam
}

function blend(a: PoseSpec, b: PoseSpec, t: number): PoseSpec {
  const aims: PoseSpec['aims'] = {}
  const keys = new Set([...Object.keys(a.aims ?? {}), ...Object.keys(b.aims ?? {})]) as Set<keyof NonNullable<PoseSpec['aims']>>
  for (const k of keys) {
    const va = a.aims?.[k]
    const vb = b.aims?.[k]
    aims[k] = va && vb ? lerpV(va, vb, t) : (t < 0.5 ? va : vb) ?? va ?? vb
  }
  const ground = a.base === 'ground' || b.base === 'ground'
  return {
    aims,
    bend: (a.bend ?? 0) + ((b.bend ?? 0) - (a.bend ?? 0)) * t,
    look: [((a.look?.[0] ?? 0) * (1 - t) + (b.look?.[0] ?? 0) * t), (a.look?.[1] ?? 0) * (1 - t) + (b.look?.[1] ?? 0) * t],
    base: ground ? 'ground' : 'stand'
  }
}

export function activityPose(act: Activity, t: number, seed = 0): PoseSpec {
  const s = Math.sin
  switch (act) {
    case 'pray':
      return prayPose(t)
    case 'kneel':
      return { aims: { ...KNEEL_LEGS }, base: 'ground' }
    case 'worship': {
      const w = s(t * 1.6 + seed) * 0.15
      return { aims: { LArm: [0.45, 0.85, 0.2 + w], LFore: [0.3, 1, 0.15], RArm: [-0.45, 0.85, 0.2 - w], RFore: [-0.3, 1, 0.15] }, look: [0, -0.35], sway: 0.06 }
    }
    case 'lift': {
      const k = 0.5 + 0.5 * s(t * 2.4 + seed)
      return { aims: { LArm: [0.18, -1, 0.12], RArm: [-0.18, -1, 0.12], LFore: lerpV([0.1, -1, 0.15], [0.05, 0.75, 0.65], k), RFore: lerpV([-0.1, -1, 0.15], [-0.05, 0.75, 0.65], k) } }
    }
    case 'run':
      return { clip: 'running' }
    case 'type': {
      const k = s(t * 9 + seed) * 0.04
      return { ...{ aims: { ...SIT_LEGS, LArm: [0.25, -0.75, 0.6], RArm: [-0.25, -0.75, 0.6], LFore: [-0.15, -0.05 + k, 1], RFore: [0.15, -0.05 - k, 1] } }, bend: 0.15, look: [0, 0.25], base: 'seat' }
    }
    case 'read':
      return { aims: { ...SIT_LEGS, LArm: [0.2, -0.8, 0.5], RArm: [-0.2, -0.8, 0.5], LFore: [-0.35, 0.45, 0.8], RFore: [0.35, 0.45, 0.8] }, bend: 0.2, look: [0, 0.5], base: 'seat' }
    case 'watch':
      return { aims: { ...SIT_LEGS, LArm: [0.2, -0.85, 0.45], RArm: [-0.2, -0.85, 0.45], LFore: [0, -0.3, 1], RFore: [0, -0.3, 1] }, look: [0, -0.05], base: 'seat' }
    case 'drink': {
      const k = Math.max(0, s(t * 0.9 + seed)) ** 3
      return { aims: { ...SIT_LEGS, LArm: [0.2, -0.85, 0.45], LFore: [0, -0.3, 1], RArm: [-0.2, -0.75, 0.6], RFore: lerpV([0.1, -0.2, 1], [0.35, 0.9, 0.3], k) }, base: 'seat' }
    }
    case 'talk': {
      const a = s(t * 2.1 + seed)
      const b2 = s(t * 1.7 + seed * 2)
      return { aims: { LArm: [0.25, -0.85, 0.35], RArm: [-0.25, -0.85, 0.35], LFore: [0.25 + a * 0.3, 0.1 + b2 * 0.2, 1], RFore: [-0.25 - b2 * 0.3, 0.1 + a * 0.25, 1] }, look: [s(t * 0.6 + seed) * 0.3, 0] }
    }
    case 'dance': {
      const a = s(t * 4 + seed)
      return { aims: { LArm: [0.7, 0.2 + a * 0.4, 0.4], RArm: [-0.7, 0.2 - a * 0.4, 0.4], LFore: [0.2, 0.8, 0.5], RFore: [-0.2, 0.8, 0.5] }, sway: 0.12 * a, clip: 'idle_2' }
    }
    case 'browse':
      return { aims: { RArm: [-0.2, -0.6, 0.7], RFore: [-0.1, 0.2 + s(t * 0.8) * 0.2, 1] }, look: [s(t * 0.5 + seed) * 0.6, 0.15] }
    case 'cook':
    case 'clean':
    case 'serve': {
      const a = s(t * (act === 'clean' ? 3 : 2.2) + seed)
      return { aims: { LArm: [0.2, -0.7, 0.6], RArm: [-0.2, -0.7, 0.6], LFore: [0.1 + a * 0.25, -0.35, 1], RFore: [-0.1 - a * 0.25, -0.35, 1] }, bend: act === 'clean' ? 0.35 : 0.15, look: [0, 0.35] }
    }
  }
}

// --------------------------------------------------------------- solver
const CHAIN: Record<string, [string, string]> = {
  LArm: ['LeftArm', 'LeftForeArm'],
  LFore: ['LeftForeArm', 'LeftHand'],
  RArm: ['RightArm', 'RightForeArm'],
  RFore: ['RightForeArm', 'RightHand'],
  LThigh: ['LeftUpLeg', 'LeftLeg'],
  LShin: ['LeftLeg', 'LeftFoot'],
  RThigh: ['RightUpLeg', 'RightLeg'],
  RShin: ['RightLeg', 'RightFoot']
}
const ORDER = ['LThigh', 'RThigh', 'LShin', 'RShin', 'LArm', 'RArm', 'LFore', 'RFore'] as const

const pa = new THREE.Vector3()
const pb = new THREE.Vector3()
const cur = new THREE.Vector3()
const want = new THREE.Vector3()
const qw = new THREE.Quaternion()
const qBody = new THREE.Quaternion()
const qParent = new THREE.Quaternion()
const qBone = new THREE.Quaternion()
const qDelta = new THREE.Quaternion()
const axX = new THREE.Vector3(1, 0, 0)
const axY = new THREE.Vector3(0, 1, 0)
const tmpQ = new THREE.Quaternion()

/** Aim a bone so it points from itself to its child along `dir` (body space). */
function aim(bone: THREE.Bone, child: THREE.Bone, dir: V, weight: number) {
  bone.getWorldPosition(pa)
  child.getWorldPosition(pb)
  cur.subVectors(pb, pa)
  if (cur.lengthSq() < 1e-12) return
  cur.normalize()
  want.set(dir[0], dir[1], dir[2]).normalize().applyQuaternion(qBody)
  qDelta.setFromUnitVectors(cur, want)
  bone.getWorldQuaternion(qBone)
  bone.parent!.getWorldQuaternion(qParent)
  // new world = delta * old world; back to local
  qw.copy(qDelta).multiply(qBone)
  tmpQ.copy(qParent).invert().multiply(qw)
  bone.quaternion.slerp(tmpQ, weight)
  bone.updateMatrixWorld(true)
}

/**
 * Apply a pose on top of the current (mocap) skeleton. `body` is the object
 * whose orientation defines body space (the avatar root). Returns the
 * vertical offset to apply to the root for 'ground' poses.
 */
export function applyPose(body: THREE.Object3D, bones: Record<string, THREE.Bone>, pose: PoseSpec, weight = 1): number {
  body.updateWorldMatrix(true, true)
  body.getWorldQuaternion(qBody)
  if (pose.bend) {
    const per = (pose.bend * weight) / 3
    for (const n of ['Spine', 'Spine1', 'Spine2']) {
      const b = bones[n]
      if (b) b.quaternion.multiply(tmpQ.setFromAxisAngle(axX, per))
    }
  }
  if (pose.sway && bones.Hips) bones.Hips.position.x += pose.sway * weight * (bones.Hips.position.y || 1)
  if (pose.look && bones.Head) {
    bones.Head.quaternion.multiply(tmpQ.setFromAxisAngle(axY, pose.look[0] * weight))
    bones.Head.quaternion.multiply(tmpQ.setFromAxisAngle(axX, pose.look[1] * weight))
  }
  body.updateMatrixWorld(true)
  for (const k of ORDER) {
    const dir = pose.aims?.[k]
    if (!dir) continue
    const [a, c] = CHAIN[k]
    if (bones[a] && bones[c]) aim(bones[a], bones[c], dir, weight)
  }
  if (pose.base !== 'ground') return 0
  // drop the body until its lowest knee / shin / foot / hand touches the floor
  let low = Infinity
  for (const n of ['LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'LeftHand', 'RightHand', 'Head']) {
    const b = bones[n]
    if (!b) continue
    b.getWorldPosition(pa)
    low = Math.min(low, pa.y)
  }
  body.getWorldPosition(pb)
  return Number.isFinite(low) ? -(low - pb.y) + 0.06 : 0
}
