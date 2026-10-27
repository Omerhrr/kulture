// rigDriver - drives the stylized human rig (utils/humanRig) for one person:
// the procedural base animation (utils/humanAnim) plus, for activities
// (pray, dance, cook, type...), the poses of utils/poses layered on top
// through a bone-name bridge (poses aim limbs by Mixamo names; the rig's
// bones share body axes, so the aims carry over unchanged).
import * as THREE from 'three'
import type { HumanRig } from './humanRig'
import { activityPose, applyPose, type Activity, type PoseSpec } from './poses'
import { HumanAnimator, type ActionName, type BaseMode } from './humanAnim'

const ACTIVITY = new Set<string>(['pray', 'worship', 'lift', 'run', 'type', 'talk', 'dance', 'browse', 'cook', 'serve', 'drink', 'watch', 'clean', 'read', 'kneel'])

export interface DriveState {
  mode: BaseMode | Activity
  /** gait speed (m/s-ish; > 11.5 starts to run) */
  gaitSpeed: number
  /** seat / bed height for sitting activities (metres) */
  seat: number
  action: ActionName | null
  actionT: number
}

export class RigDriver {
  private anim: HumanAnimator
  private bones: THREE.Bone[]
  private unposed: THREE.Quaternion[]
  private unposedHips = new THREE.Vector3()
  private posed = false
  private clock = 0
  private poseBones: Record<string, THREE.Bone>

  constructor(
    private rig: HumanRig,
    private phase = 0
  ) {
    this.anim = new HumanAnimator(rig, phase)
    this.bones = Object.values(rig.bones)
    this.unposed = this.bones.map((b) => b.quaternion.clone())
    const B = rig.bones
    this.poseBones = {
      Hips: B.hips!, Spine: B.spine!, Spine1: B.chest!, Spine2: B.chest!, Neck: B.neck!, Head: B.head!,
      LeftArm: B.upperArmL!, LeftForeArm: B.foreArmL!, LeftHand: B.handL!,
      RightArm: B.upperArmR!, RightForeArm: B.foreArmR!, RightHand: B.handR!,
      LeftUpLeg: B.thighL!, LeftLeg: B.shinL!, LeftFoot: B.footL!, LeftToeBase: B.toeL!,
      RightUpLeg: B.thighR!, RightLeg: B.shinR!, RightFoot: B.footR!, RightToeBase: B.toeR!
    }
  }

  update(dt: number, s: DriveState) {
    this.clock += dt
    const hips = this.rig.bones.hips!
    // The animator eases each bone from where it is; a pose layered on top
    // must not feed back into that (a spine bend would compound frame after
    // frame), so restore the un-posed state first.
    if (this.posed) {
      this.bones.forEach((b, i) => b.quaternion.copy(this.unposed[i]!))
      hips.position.copy(this.unposedHips)
      this.posed = false
    }
    const act = ACTIVITY.has(s.mode) ? (s.mode as Activity) : null
    // congregational prayer: everyone on the same clock so rows move as one
    const spec: PoseSpec | null = act ? activityPose(act, act === 'pray' ? performance.now() / 1000 : this.clock, this.phase * 3.1) : null
    const running = spec?.clip === 'running' || s.mode === 'run'
    const base: BaseMode = spec ? (spec.base === 'seat' ? 'sit' : 'idle') : ACTIVITY.has(s.mode) ? 'idle' : (s.mode as BaseMode)
    this.anim.update(dt, {
      mode: running ? 'walk' : base,
      run: running ? 1 : Math.min(1, Math.max(0, (s.gaitSpeed - 11.5) / 3.5)),
      gait: (running ? 14 : s.gaitSpeed) * 0.62,
      seat: s.seat,
      action: s.action,
      actionT: s.actionT
    })
    const root = this.rig.root
    root.position.y = 0
    if (spec && (spec.aims || spec.bend || spec.look || spec.sway || spec.base === 'ground')) {
      this.bones.forEach((b, i) => this.unposed[i]!.copy(b.quaternion))
      this.unposedHips.copy(hips.position)
      this.posed = true
      const dy = applyPose(root, this.poseBones, spec)
      if (spec.base === 'ground') root.position.y = dy
    }
  }
}
