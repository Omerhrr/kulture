// The shape every animated person shares: a skeleton of named bones (hips,
// spine, chest, neck, head, clav/upperArm/foreArm/hand + fingers, thigh/
// shin/foot/toe; L = the person's left, +x) in rest pose (identity
// rotations, standing, arms hanging, facing +z), animated by
// utils/humanAnim + utils/rigDriver. Built by utils/humanBody.
import type * as THREE from 'three'

export type BoneName = string
export interface HumanRig {
  root: THREE.Group
  bones: Record<BoneName, THREE.Bone>
  /** rest positions (bone-local); rest.hips.y is the standing hip height */
  rest: Record<BoneName, THREE.Vector3>
  dispose: () => void
}
