<script setup lang="ts">
// MixamoAvatar - a motion-captured Mixamo character driven by the same
// props as CharacterAvatar (mode / gaitSpeed / action / seat). Locomotion
// and idles cross-fade; one-shot actions (jump, punch, kick, push, wave,
// stagger) play over the base and fade back. Sit / eat / sleep are posed
// on top of the idle clip (no mocap needed). Shows nothing until loaded.
import * as THREE from 'three'
import { createMixamo, type MixamoCharacter, type MixamoInstance } from '~/utils/mixamo'
import type { ActionName, BaseMode } from '~/utils/humanAnim'
import { activityPose, applyPose, type Activity } from '~/utils/poses'
import { dressTexture, paintOutfit, wearGadgets, type Look } from '~/utils/wardrobe'

const props = withDefaults(
  defineProps<{
    character: MixamoCharacter
    mode?: BaseMode | Activity
    gaitSpeed?: number
    action?: ActionName | null
    actionKey?: number
    seat?: number
    scale?: number
    phase?: number
    tint?: string
    /** clothes, skin tone and gadgets for this person */
    look?: Look
    /** dev: [bone, axis, angle] extra rotation for pose calibration */
    debugRot?: [string, 'x' | 'y' | 'z', number][]
  }>(),
  { mode: 'idle', gaitSpeed: 11, action: null, actionKey: 0, seat: 0.45, scale: 1, phase: 0, tint: undefined, look: undefined }
)
const emit = defineEmits<{ ready: [] }>()

const holder = new THREE.Group()
let inst: MixamoInstance | null = null
let base: THREE.AnimationAction | null = null
let baseName = ''
let oneShot: THREE.AnimationAction | null = null
let disposed = false

const ACTION_CLIP: Record<ActionName, { clip: string; speed: number; loop?: boolean }> = {
  jump: { clip: 'jumping_up', speed: 0.6 },
  punch: { clip: 'punching', speed: 1.35 },
  kick: { clip: 'drop_kick', speed: 1.7 },
  push: { clip: 'punching', speed: 1.1 },
  wave: { clip: 'idle_2', speed: 1.0 },
  stagger: { clip: 'hard_landing', speed: 1.4 }
}

createMixamo(props.character).then((m) => {
  if (disposed) return
  inst = m
  holder.add(m.root)
  m.root.scale.setScalar(props.scale)
  // characters that ship without a texture are painted per person
  const paintKind = null as null | 'caftan' | 'hijab' // painted bodies parked for now
  const look: Look | undefined = props.look ?? (paintKind ? { skin: '#7a4e33', top: paintKind === 'caftan' ? '#efe8d6' : '#2b3440', bottom: '#5a2a4a' } : undefined)
  if (look) {
    m.root.traverse((o: any) => {
      if (!o.isSkinnedMesh || !o.material) return
      try {
        if (paintKind) {
          o.material.map = paintOutfit(o, paintKind, look)
          o.material.color?.set('#ffffff')
          // cloth and skin, not plastic
          if ('roughness' in o.material) {
            o.material.roughness = 0.9
            o.material.metalness = 0
          }
        } else if (o.material.map) o.material.map = dressTexture(o, o.material.map, look)
        o.material.needsUpdate = true
      } catch {
        /* texture not readable: keep the base outfit */
      }
    })
    wearGadgets(m.root, m.bones, look)
  }
  m.mixer.addEventListener('finished', (e: any) => {
    if (e.action === oneShot) {
      oneShot.fadeOut(0.25)
      base?.reset().fadeIn(0.25).play()
      oneShot = null
    }
  })
  setBase()
  emit('ready')
})

const ACTIVITY = new Set(['pray', 'worship', 'lift', 'run', 'type', 'talk', 'dance', 'browse', 'cook', 'serve', 'drink', 'watch', 'clean', 'read', 'kneel'])
function wantBase(): { name: string; speed: number } {
  if (ACTIVITY.has(props.mode)) {
    const c = activityPose(props.mode as Activity, 0, props.phase).clip
    if (c === 'running') return { name: 'running', speed: 0.85 }
    if (c) return { name: c, speed: 1.3 }
  }
  if (props.mode === 'walk' || props.mode === 'ride') {
    const run = props.gaitSpeed > 11.5
    return run ? { name: 'running', speed: Math.max(0.7, props.gaitSpeed / 14) } : { name: 'walking', speed: Math.max(0.6, props.gaitSpeed / 9.5) }
  }
  // a few different idles so a crowd doesn't breathe in sync
  const idles = ['idle', 'idle_3', 'idle']
  return { name: idles[Math.abs(Math.floor(props.phase * 7)) % idles.length], speed: 1 }
}

function setBase() {
  if (!inst) return
  const w = wantBase()
  const clip = inst.clips[w.name] ?? inst.clips.idle
  if (!clip) return
  if (w.name !== baseName) {
    const next = inst.mixer.clipAction(clip)
    next.reset()
    next.time = (props.phase * 1.7) % clip.duration
    next.setEffectiveWeight(1)
    if (base && !oneShot) {
      next.play()
      base.crossFadeTo(next, 0.3, false)
    } else next.play()
    base = next
    baseName = w.name
  }
  base!.timeScale = w.speed
}

watch(
  () => props.actionKey,
  () => {
    if (!inst || !props.action) return
    const spec = ACTION_CLIP[props.action]
    const clip = inst.clips[spec.clip]
    if (!clip) return
    oneShot?.stop()
    const a = inst.mixer.clipAction(clip)
    a.reset()
    a.setLoop(THREE.LoopOnce, 1)
    a.clampWhenFinished = false
    a.timeScale = spec.speed
    a.play()
    if (base) base.crossFadeTo(a, 0.12, false)
    oneShot = a
  }
)

// procedural poses layered over the idle clip
const qTmp = new THREE.Quaternion()
const ax = new THREE.Vector3(1, 0, 0)
function bend(bone: THREE.Bone | undefined, angle: number) {
  if (!bone) return
  qTmp.setFromAxisAngle(ax, angle)
  bone.quaternion.multiply(qTmp)
}

// Seated: the hip joint rests this far above the seat surface (same as the
// procedural rig in utils/humanAnim). The root is lowered by the model's
// own standing hip height, measured once - a fixed guess (seat - 0.47) left
// these ~1 m-hipped bodies floating half a metre up, heads through car roofs.
const SEAT_HIP = 0.1
let hipsHeight: number | null = null
const _hp = new THREE.Vector3()
function measureHips(r: THREE.Object3D, hips: THREE.Bone | undefined): number {
  if (hipsHeight === null && hips && r.parent) {
    r.updateMatrixWorld(true)
    r.parent.worldToLocal(hips.getWorldPosition(_hp))
    hipsHeight = _hp.y - r.position.y
  }
  return hipsHeight ?? 0.95
}

let clock = Math.random() * 20
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  if (!inst) return
  const dt = Math.min(delta || 0.016, 0.1)
  if (!oneShot) setBase()
  else if (base) base.timeScale = wantBase().speed
  inst.mixer.update(dt)
  const b = inst.bones
  const r = inst.root
  r.rotation.set(0, 0, 0)
  r.position.set(0, 0, 0)
  clock += dt
  // what this person is doing: activity poses over the mocap
  const act: Activity | null = ACTIVITY.has(props.mode)
    ? (props.mode as Activity)
    : props.mode === 'sit'
      ? 'watch'
      : props.mode === 'eat'
        ? 'drink'
        : null
  if (act) {
    // congregational prayer: everyone on the same clock so rows move as one
    const spec = activityPose(act, act === 'pray' ? performance.now() / 1000 : clock, props.phase * 3.1)
    if (spec.base === 'seat') {
      r.position.y = props.seat + SEAT_HIP - measureHips(r, b.Hips)
      r.position.z = -0.12
    }
    const dy = applyPose(r, b, spec)
    if (spec.base === 'ground') r.position.y += dy
  } else if (props.mode === 'sleep') {
    // lying on the back on the mattress
    r.rotation.x = -Math.PI / 2
    r.position.y = props.seat + 0.12
    r.position.z = -0.9
  }
  for (const [bn, axn, ang] of props.debugRot ?? []) {
    const bo = b[bn]
    if (!bo) continue
    qTmp.setFromAxisAngle(axn === 'x' ? ax : axn === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1), ang)
    bo.quaternion.multiply(qTmp)
  }
  // retargeted characters copy the (posed) driver skeleton onto their rig
  inst.sync?.()
})

onBeforeUnmount(() => {
  disposed = true
  inst?.mixer.stopAllAction()
  inst?.root.traverse((o: any) => {
    if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose())
  })
})
</script>

<template>
  <primitive :object="holder" />
</template>
