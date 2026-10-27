// Procedural animation for the v3 human rig.
//
// Base layer: idle (breathing, weight shift, glances), walk/run gait cycle
// (pelvis twist + bob, shoulder counter-rotation, knee flex timed to the
// stride, foot roll, arm swing with elbow bend), and poses: sit, eat,
// sleep (lying down), ride.
// Action layer (blended over the base with an in/out envelope): jump,
// punch, kick, push, wave, stagger (hit reaction).
// Every bone eases toward its target, so switching states never snaps.
import * as THREE from 'three'
import type { HumanRig } from './humanRig'

export type BaseMode = 'idle' | 'walk' | 'sit' | 'ride' | 'sleep' | 'eat'
export type ActionName = 'jump' | 'punch' | 'kick' | 'push' | 'wave' | 'stagger'
export const ACTION_DUR: Record<ActionName, number> = { jump: 0.9, punch: 0.5, kick: 0.72, push: 0.6, wave: 1.6, stagger: 0.7 }

export interface AnimState {
  mode: BaseMode
  /** 0 = walk, 1 = full run */
  run: number
  /** gait speed (radians of cycle per second) */
  gait: number
  /** seat / bed surface height for sit, eat, sleep */
  seat: number
  action: ActionName | null
  /** seconds since the action started */
  actionT: number
}

type E = [number, number, number]
const SIDES = [
  [1, 'L'],
  [-1, 'R']
] as const
const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky']

export class HumanAnimator {
  private rig: HumanRig
  private phase: number
  private t = 0
  private qa = new THREE.Quaternion()
  private qb = new THREE.Quaternion()
  private eu = new THREE.Euler()
  private hipsTarget = new THREE.Vector3()

  constructor(rig: HumanRig, phase = 0) {
    this.rig = rig
    this.phase = phase
    this.t = phase * 7.3
  }

  update(dt: number, s: AnimState) {
    this.t += dt
    if (s.mode === 'walk') this.phase += dt * s.gait
    const base = this.base(s)
    const act = s.action ? this.action(s.action, s.actionT) : null
    const w = s.action ? envelope(s.action, s.actionT) : 0
    const k = 1 - Math.exp(-dt * (s.action ? 26 : s.mode === 'walk' ? 20 : 11))
    const bones = this.rig.bones
    for (const name in bones) {
      const b = bones[name]
      const be = base.r[name] ?? ZERO
      this.qa.setFromEuler(this.eu.set(be[0], be[1], be[2]))
      const ae = act?.r[name]
      if (ae && w > 0) {
        this.qb.setFromEuler(this.eu.set(ae[0], ae[1], ae[2]))
        this.qa.slerp(this.qb, w)
      }
      b.quaternion.slerp(this.qa, k)
    }
    // hips translation (bob, sitting down, lying down, jump crouch)
    const rest = this.rig.rest.hips
    const dy = base.hipsY + (act && w > 0 ? (act.hipsY - base.hipsY) * w : 0)
    const dz = base.hipsZ
    this.hipsTarget.set(rest.x, rest.y + dy, rest.z + dz)
    bones.hips.position.lerp(this.hipsTarget, k)
  }

  // ---------------------------------------------------------------- base layer
  private base(s: AnimState): { r: Record<string, E>; hipsY: number; hipsZ: number } {
    const r: Record<string, E> = {}
    let hipsY = 0
    let hipsZ = 0
    const e = this.t
    const curl = (k: string, side: number, c: number, thumb = c) => {
      for (const f of FINGER_NAMES) {
        r[f + '1' + k] = [0, 0, -side * c * 1.05]
        r[f + '2' + k] = [0, 0, -side * c * 1.3]
      }
      r['thumb1' + k] = [thumb * 0.35, 0, -side * thumb * 0.45]
      r['thumb2' + k] = [0, 0, -side * thumb * 0.6]
    }
    const breathe = Math.sin(e * 1.7) * 0.012

    if (s.mode === 'walk') {
      const p = this.phase
      const run = s.run
      const sn = Math.sin(p)
      const legA = 0.42 + run * 0.38
      const armA = 0.38 + run * 0.42
      hipsY = -0.012 - run * 0.03 + Math.cos(p * 2) * (0.018 + run * 0.02)
      r.hips = [0, sn * (0.09 + run * 0.04), Math.cos(p) * 0.035]
      r.spine = [0.03 + run * 0.12, -sn * 0.05, 0]
      r.chest = [0.02 + run * 0.08 + breathe, -sn * (0.08 + run * 0.05), -Math.cos(p) * 0.02]
      r.neck = [-0.02 - run * 0.08, sn * 0.05, 0]
      r.head = [-0.02 - run * 0.08, sn * 0.04, 0]
      for (const [side, k] of SIDES) {
        const ph = side > 0 ? p : p + Math.PI
        const sw = Math.sin(ph)
        r['thigh' + k] = [-sw * legA - run * 0.15, 0, side * 0.02]
        // knee flexes in swing (after toe-off), near-straight at heel strike
        const flex = Math.max(0, Math.sin(ph - 1.1))
        r['shin' + k] = [0.08 + flex * (0.95 + run * 0.75), 0, 0]
        // foot: dorsiflex at heel strike, plantarflex at toe-off
        r['foot' + k] = [-Math.cos(ph - 0.4) * 0.22 + flex * 0.15, 0, 0]
        r['toe' + k] = [Math.max(0, -sw) * 0.3, 0, 0]
        r['clav' + k] = [0, 0, side * 0.02]
        r['upperArm' + k] = [sw * armA, 0, side * (0.09 + run * 0.06)]
        r['foreArm' + k] = [-(0.22 + run * 1.15) - Math.max(0, -sw) * 0.25, 0, 0]
        r['hand' + k] = [0, -side * 0.1, 0]
        curl(k, side, 0.4 + run * 0.4)
      }
    } else if (s.mode === 'sit' || s.mode === 'eat') {
      hipsY = s.seat + 0.1 - this.rig.rest.hips!.y // hips rest on the seat (any body height)
      hipsZ = -0.04
      r.hips = [0, 0, 0]
      r.spine = [0.05 + breathe, 0, 0]
      r.chest = [0.04 + breathe, 0, 0]
      r.head = [0.05 + Math.sin(e * 0.5) * 0.04, Math.sin(e * 0.3) * 0.25, 0]
      for (const [side, k] of SIDES) {
        r['thigh' + k] = [-1.52, 0, side * 0.07]
        r['shin' + k] = [1.5, 0, -side * 0.05]
        r['foot' + k] = [0.02, 0, 0]
        r['upperArm' + k] = [-0.38, 0, side * 0.12]
        r['foreArm' + k] = [-0.95, 0, 0]
        r['hand' + k] = [0.25, 0, 0]
        curl(k, side, 0.45)
      }
      if (s.mode === 'eat') {
        // spoon to mouth every ~2.4 s
        const lift = 0.5 - 0.5 * Math.cos(Math.min(1, (e % 2.4) / 1.1) * Math.PI * 2)
        r.upperArmR = [-0.45 - lift * 0.55, 0, -0.25]
        r.foreArmR = [-1.0 - lift * 1.25, 0, 0]
        r.handR = [0.3, 0.4, 0]
        r.head = [0.12 - lift * 0.08, 0, 0]
        curl('R', -1, 0.8)
      }
    } else if (s.mode === 'sleep') {
      // lying on the back; the hips bone turns the whole body flat
      hipsY = s.seat + 0.12 - this.rig.rest.hips!.y
      r.hips = [-Math.PI / 2, 0, 0]
      r.spine = [0, 0, 0]
      r.chest = [Math.sin(e * 0.9) * 0.02, 0, 0]
      r.neck = [0.1, 0, 0]
      r.head = [0.05, 0.35, 0]
      for (const [side, k] of SIDES) {
        r['thigh' + k] = [0.02, 0, side * 0.05]
        r['shin' + k] = [0.12, 0, 0]
        r['foot' + k] = [-0.45, 0, 0]
        // arms rest along the body, hands on the belly
        r['upperArm' + k] = [0.04, 0, side * 0.12]
        r['foreArm' + k] = [-0.12, 0, 0]
        curl(k, side, 0.35)
      }
    } else if (s.mode === 'ride') {
      r.chest = [0.22, 0, 0]
      r.head = [-0.15, 0, 0]
      for (const [side, k] of SIDES) {
        r['thigh' + k] = [-1.05, 0, side * 0.3]
        r['shin' + k] = [1.3, 0, 0]
        r['upperArm' + k] = [-1.05, 0, side * 0.22]
        r['foreArm' + k] = [-0.35, 0, 0]
        curl(k, side, 0.85)
      }
    } else {
      // idle: breathe, shift weight, look around
      const shift = Math.sin(e * 0.55) * 0.035
      hipsY = -Math.abs(shift) * 0.25
      r.hips = [0, Math.sin(e * 0.2) * 0.04, shift * 0.6]
      r.spine = [breathe, 0, -shift * 0.4]
      r.chest = [breathe * 1.3, 0, -shift * 0.3]
      r.neck = [0, Math.sin(e * 0.37) * 0.15, 0]
      r.head = [Math.sin(e * 0.23) * 0.04, Math.sin(e * 0.41) * 0.2, 0]
      for (const [side, k] of SIDES) {
        r['thigh' + k] = [0, 0, side * 0.02 - shift * 0.4]
        r['shin' + k] = [0.04 + Math.max(0, side * shift) * 1.4, 0, 0]
        r['foot' + k] = [-Math.max(0, side * shift) * 0.5, 0, shift * 0.4]
        r['upperArm' + k] = [Math.sin(e * 1.3 + side) * 0.025, 0, side * 0.075]
        r['foreArm' + k] = [-0.14, 0, 0]
        r['hand' + k] = [0, -side * 0.15, 0]
        curl(k, side, 0.32)
      }
    }
    return { r, hipsY, hipsZ }
  }

  // ---------------------------------------------------------------- action layer
  private action(name: ActionName, t: number): { r: Record<string, E>; hipsY: number } {
    const r: Record<string, E> = {}
    let hipsY = 0
    const fist = (k: string, side: number, c = 1) => {
      for (const f of FINGER_NAMES) {
        r[f + '1' + k] = [0, 0, -side * 1.45 * c]
        r[f + '2' + k] = [0, 0, -side * 1.6 * c]
      }
      r['thumb1' + k] = [0.5 * c, 0, -side * 0.7 * c]
      r['thumb2' + k] = [0, 0, -side * 0.8 * c]
    }
    const open = (k: string) => {
      for (const f of FINGER_NAMES) {
        r[f + '1' + k] = [0, 0, 0]
        r[f + '2' + k] = [0, 0, 0]
      }
      r['thumb1' + k] = [0, 0, 0]
      r['thumb2' + k] = [0, 0, 0]
    }
    const seg = (a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)))
    const mix = (x: number, y: number, f: number) => x + (y - x) * f

    switch (name) {
      case 'jump': {
        const crouch = 1 - seg(0.05, 0.16) + seg(0.68, 0.76) * (1 - seg(0.78, 0.9))
        const air = seg(0.12, 0.24) * (1 - seg(0.64, 0.74))
        hipsY = -0.16 * crouch
        r.spine = [0.25 * crouch - 0.08 * air, 0, 0]
        r.chest = [0.1 * crouch, 0, 0]
        r.head = [-0.15 * crouch, 0, 0]
        for (const [side, k] of SIDES) {
          r['thigh' + k] = [-0.75 * crouch - 0.55 * air, 0, side * 0.05]
          r['shin' + k] = [1.2 * crouch + 0.85 * air, 0, 0]
          r['foot' + k] = [-0.45 * crouch + 0.35 * air, 0, 0]
          r['upperArm' + k] = [0.6 * crouch - 1.5 * air, 0, side * (0.15 + 0.35 * air)]
          r['foreArm' + k] = [-0.3 - 0.4 * air, 0, 0]
          fist(k, side, 0.5)
        }
        break
      }
      case 'punch': {
        const wind = seg(0, 0.12)
        const hit = seg(0.12, 0.22)
        const back = seg(0.28, 0.5)
        const ext = hit * (1 - back)
        hipsY = -0.04
        r.hips = [0, mix(-0.15 * wind, 0.3, ext), 0]
        r.chest = [0.05, mix(-0.25 * wind, 0.45, ext), 0]
        r.head = [0, mix(0.2, -0.35, ext), 0]
        // right arm drives, left guards the face
        r.upperArmR = [mix(-0.7, -1.55, ext), 0, mix(-0.35, 0.05, ext)]
        r.foreArmR = [mix(-1.9, -0.05, ext), 0, 0]
        r.handR = [0, mix(0, 1.4, ext), 0]
        r.upperArmL = [-1.05, 0, 0.35]
        r.foreArmL = [-2.15, 0, 0]
        fist('R', -1)
        fist('L', 1)
        r.thighL = [-0.35, 0, 0.1]
        r.shinL = [0.35, 0, 0]
        r.thighR = [0.25, 0, -0.08]
        r.shinR = [0.3, 0, 0]
        break
      }
      case 'kick': {
        const chamber = seg(0, 0.18)
        const ext = seg(0.18, 0.32) * (1 - seg(0.4, 0.62))
        const lift = chamber * (1 - seg(0.45, 0.66))
        r.spine = [-0.3 * ext, 0, 0.05]
        r.chest = [-0.15 * ext, 0, 0]
        r.thighR = [mix(-1.15 * lift, -1.55, ext), 0, -0.05]
        r.shinR = [mix(1.7 * lift, 0.05, ext), 0, 0]
        r.footR = [mix(0, 0.65, ext), 0, 0]
        r.thighL = [0.1, 0, 0.06]
        r.shinL = [0.2, 0, 0]
        for (const [side, k] of SIDES) {
          r['upperArm' + k] = [-0.35, 0, side * (0.45 + 0.35 * ext)]
          r['foreArm' + k] = [-0.6, 0, 0]
          fist(k, side, 0.8)
        }
        break
      }
      case 'push': {
        const reach = seg(0, 0.18) * (1 - seg(0.36, 0.6))
        const shove = seg(0.12, 0.26) * (1 - seg(0.36, 0.6))
        hipsY = -0.05 * reach
        r.spine = [0.18 * reach, 0, 0]
        r.chest = [0.12 * shove, 0, 0]
        r.thighR = [-0.5 * reach, 0, 0]
        r.shinR = [0.4 * reach, 0, 0]
        r.thighL = [0.3 * reach, 0, 0]
        for (const [side, k] of SIDES) {
          r['upperArm' + k] = [-1.35 * reach, 0, side * mix(0.15, 0.08, shove)]
          r['foreArm' + k] = [mix(-1.1, -0.1, shove) * reach, 0, 0]
          r['hand' + k] = [1.0 * reach, 0, 0]
          open(k)
        }
        break
      }
      case 'wave': {
        const up = seg(0, 0.25) * (1 - seg(1.3, 1.6))
        const osc = Math.sin(t * 11) * 0.35
        r.upperArmR = [-0.3 * up, 0, -2.5 * up]
        r.foreArmR = [0, 0, (-0.6 + osc) * up]
        r.head = [0, -0.2 * up, 0]
        open('R')
        break
      }
      case 'stagger': {
        const f = seg(0, 0.12) * (1 - seg(0.35, 0.7))
        hipsY = -0.05 * f
        r.spine = [-0.35 * f, 0, 0.08 * f]
        r.chest = [-0.25 * f, 0, 0]
        r.head = [-0.4 * f, 0.2 * f, 0]
        r.thighR = [0.45 * f, 0, -0.05]
        r.shinR = [0.35 * f, 0, 0]
        r.thighL = [-0.15 * f, 0, 0.05]
        for (const [side, k] of SIDES) {
          r['upperArm' + k] = [-0.5 * f, 0, side * 0.9 * f]
          r['foreArm' + k] = [-0.5 * f, 0, 0]
          open(k)
        }
        break
      }
    }
    return { r, hipsY }
  }
}

const ZERO: E = [0, 0, 0]
function envelope(name: ActionName, t: number): number {
  const d = ACTION_DUR[name]
  const inn = Math.min(1, t / 0.06)
  const out = Math.min(1, Math.max(0, (d - t) / 0.12))
  return Math.min(inn, out)
}
