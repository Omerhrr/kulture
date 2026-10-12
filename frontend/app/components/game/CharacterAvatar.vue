<script setup lang="ts">
// Shared human character (player + named NPCs).
//
// v2: real adult proportions (1.78 m, head = 1/7.5 of the body instead of
// the old chibi 1/4), jointed limbs (hip -> knee, shoulder -> elbow) so the
// gait reads as walking rather than scissoring, smooth capsule limbs,
// hands and shoes, a smaller detailed face, and Northern Nigerian outfits:
//   kaftan - knee-length tunic over trousers (with kufi cap)
//   dress  - long gown / wrapper with hijab
//   shirt  - shirt + trousers
// Animation modes: walk (gait cycle), idle (breathing + weight shift), sit.
// The rig is built imperatively and driven from useLoop.
import * as THREE from 'three'

const props = withDefaults(
  defineProps<{
    shirt?: string
    trouser?: string
    skin?: string
    kufi?: boolean
    hijab?: boolean
    hairStyle?: 'cap' | 'afro' | 'braids' | 'bald'
    hairColor?: string
    beard?: boolean
    outfit?: 'kaftan' | 'dress' | 'shirt'
    scale?: number
    mode?: 'idle' | 'walk' | 'sit' | 'ride'
    gaitSpeed?: number
    phase?: number
  }>(),
  {
    shirt: '#2e7d5b',
    trouser: '#2b3440',
    skin: '#7a4e33',
    kufi: true,
    hijab: false,
    hairStyle: 'cap',
    hairColor: '#141114',
    beard: false,
    outfit: undefined,
    scale: 1,
    mode: 'idle',
    gaitSpeed: 11,
    phase: 0
  }
)

const outfit = props.outfit ?? (props.hijab ? 'dress' : props.kufi ? 'kaftan' : 'shirt')

const std = (color: string, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
const M = {
  cloth: std(props.shirt, 0.85),
  trouser: std(props.trouser, 0.9),
  skin: std(props.skin, 0.6),
  hair: std(props.hairColor, 0.95),
  shoe: std('#1d1c1f', 0.5),
  sole: std('#e8e4dc', 0.7),
  eye: std('#f2efe8', 0.3),
  pupil: std('#160f0c', 0.2),
  lip: std('#5a3028', 0.7),
  cap: std(props.hijab ? '#e9e2d0' : '#f1ece0', 0.9),
  trim: std('#e6c66a', 0.6)
}

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}
const capsule = (r: number, len: number, mat: THREE.Material, y: number) => mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat, 0, y, 0)
const ball = (r: number, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 14) => {
  const m = mesh(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.75))), mat, x, y, z)
  m.scale.set(sx, sy, sz)
  return m
}

// ------------------------------------------------------------------ rig
const root = new THREE.Group()
const body = new THREE.Group()
root.add(body)

const HIP_Y = 0.94
function makeLeg(side: number) {
  const hip = new THREE.Group()
  hip.position.set(side * 0.1, HIP_Y, 0)
  const legMat = outfit === 'dress' ? M.skin : M.trouser
  hip.add(capsule(0.078, 0.3, legMat, -0.22))
  const knee = new THREE.Group()
  knee.position.y = -0.45
  hip.add(knee)
  knee.add(capsule(0.06, 0.3, legMat, -0.21))
  // shoe: upper + sole, toe forward (+z)
  const foot = new THREE.Group()
  foot.position.y = -0.44
  knee.add(foot)
  foot.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.25), M.shoe, 0, -0.01, 0.05))
  foot.add(mesh(new THREE.BoxGeometry(0.105, 0.025, 0.26), M.sole, 0, -0.055, 0.05))
  body.add(hip)
  return { hip, knee }
}
const legL = makeLeg(-1)
const legR = makeLeg(1)

// pelvis + torso
body.add(ball(0.17, outfit === 'shirt' ? M.trouser : M.cloth, 0, 0.96, 0, 1, 0.62, 0.72))
const chest = new THREE.Group()
chest.position.y = 1.0
body.add(chest)
{
  const torso = new THREE.CylinderGeometry(0.19, 0.165, 0.5, 16)
  const t = mesh(torso, M.cloth, 0, 0.24, 0)
  t.scale.z = 0.66
  chest.add(t)
  // rounded shoulders + upper chest
  chest.add(ball(0.19, M.cloth, 0, 0.45, 0, 1.05, 0.42, 0.68, 16))
  // neck
  chest.add(mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.12, 10), M.skin, 0, 0.56, 0.005))
  if (outfit === 'kaftan') {
    // knee-length tunic with an embroidered neckline
    const tunic = mesh(new THREE.CylinderGeometry(0.2, 0.29, 0.78, 18, 1, true), M.cloth, 0, -0.2, 0)
    tunic.scale.z = 0.72
    ;(tunic.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    chest.add(tunic)
    chest.add(mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), M.trim, 0, 0.5, 0.075))
    chest.add(mesh(new THREE.BoxGeometry(0.03, 0.22, 0.01), M.trim, 0, 0.36, 0.128))
  } else if (outfit === 'dress') {
    const gown = mesh(new THREE.CylinderGeometry(0.19, 0.36, 0.98, 18, 1, true), M.cloth, 0, -0.42, 0)
    gown.scale.z = 0.8
    ;(gown.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    chest.add(gown)
  } else {
    // collar + buttons
    chest.add(mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), M.sole, 0, 0.53, 0.07))
    chest.add(mesh(new THREE.BoxGeometry(0.015, 0.36, 0.01), M.sole, 0, 0.3, 0.127))
  }
}

function makeArm(side: number) {
  const shoulder = new THREE.Group()
  shoulder.position.set(side * 0.225, 0.43, 0)
  chest.add(shoulder)
  const sleeveR = outfit === 'kaftan' ? 0.066 : 0.054
  shoulder.add(capsule(sleeveR, 0.2, M.cloth, -0.14))
  const elbow = new THREE.Group()
  elbow.position.y = -0.29
  shoulder.add(elbow)
  const foreMat = outfit === 'shirt' ? M.skin : M.cloth
  elbow.add(capsule(outfit === 'kaftan' ? 0.06 : 0.045, 0.17, foreMat, -0.12))
  if (outfit !== 'shirt') elbow.add(capsule(0.04, 0.04, M.skin, -0.23))
  elbow.add(ball(0.046, M.skin, 0, -0.29, 0.01, 0.8, 1.15, 0.6))
  return { shoulder, elbow }
}
const armL = makeArm(-1)
const armR = makeArm(1)

// head
const head = new THREE.Group()
head.position.y = 0.68
chest.add(head)
{
  head.add(ball(0.112, M.skin, 0, 0, 0, 0.9, 1.08, 1.0, 20))
  head.add(ball(0.08, M.skin, 0, -0.055, 0.03, 0.95, 0.75, 1.0)) // jaw
  for (const s of [-1, 1]) {
    head.add(ball(0.026, M.skin, s * 0.102, -0.005, -0.005, 0.5, 1, 0.8, 8))
    head.add(ball(0.018, M.eye, s * 0.038, 0.012, 0.094, 1.2, 0.8, 0.6, 10))
    head.add(ball(0.0095, M.pupil, s * 0.038, 0.012, 0.104, 1, 1, 0.6, 8))
    head.add(mesh(new THREE.BoxGeometry(0.042, 0.009, 0.012), M.hair, s * 0.038, 0.041, 0.097))
  }
  const nose = mesh(new THREE.ConeGeometry(0.02, 0.045, 8), M.skin, 0, -0.012, 0.108)
  nose.rotation.x = Math.PI / 2.4
  head.add(nose)
  head.add(ball(0.022, M.skin, 0, -0.03, 0.104, 1.3, 0.7, 0.8, 8)) // nostrils
  head.add(mesh(new THREE.BoxGeometry(0.052, 0.012, 0.014), M.lip, 0, -0.062, 0.094))
  if (props.beard && !props.hijab) {
    head.add(ball(0.085, M.hair, 0, -0.07, 0.035, 1.0, 0.75, 0.85, 12))
    head.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), M.hair, 0, -0.045, 0.1))
  }
  if (!props.hijab) {
    if (props.hairStyle === 'cap' || props.hairStyle === 'braids') {
      head.add(ball(0.116, M.hair, 0, 0.022, -0.008, 0.93, 0.95, 1.0, 16))
    } else if (props.hairStyle === 'afro') {
      head.add(ball(0.15, M.hair, 0, 0.05, -0.02, 1, 0.9, 1, 16))
    }
    if (props.hairStyle === 'braids') {
      for (let i = -2; i <= 2; i++) head.add(capsule(0.016, 0.2, M.hair, -0.1).translateX(i * 0.035).translateZ(-0.09))
    }
    if (props.kufi) {
      // embroidered kufi / hula cap
      head.add(mesh(new THREE.CylinderGeometry(0.104, 0.112, 0.085, 18), M.cap, 0, 0.085, -0.006))
      head.add(mesh(new THREE.CylinderGeometry(0.113, 0.113, 0.016, 18), M.trim, 0, 0.05, -0.006))
    }
  } else {
    // hijab wraps the head and drapes over the shoulders
    // an open hood: the sphere leaves a face opening at the front (+z)
    const open = 2.0 // radians of the face opening
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.128, 22, 16, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, Math.PI * 0.82), M.cap)
    hood.position.set(0, 0.012, -0.012)
    hood.scale.set(0.95, 1.08, 1.02)
    ;(hood.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    hood.castShadow = true
    head.add(hood)
    // soft band framing the face
    head.add(mesh(new THREE.TorusGeometry(0.098, 0.014, 8, 20, Math.PI * 1.25), M.cap, 0, 0.0, 0.068).rotateZ(-Math.PI * 0.125 + Math.PI / 2 - Math.PI * 0.5))
    const drape = mesh(new THREE.CylinderGeometry(0.11, 0.26, 0.3, 18, 1, true), M.cap, 0, -0.17, -0.01)
    drape.scale.z = 0.85
    ;(drape.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    head.add(drape)
  }
}

root.scale.setScalar(props.scale)

// ------------------------------------------------------------------ animation
let t = props.phase
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  const dt = Math.min(delta || 0.016, 0.1)
  if (props.mode === 'walk') {
    t += dt * props.gaitSpeed
    legL.hip.rotation.z = legR.hip.rotation.z = 0
    const s = Math.sin(t)
    const run = Math.min(1, Math.max(0, (props.gaitSpeed - 11) / 4))
    const swing = 0.5 + run * 0.25
    legL.hip.rotation.x = -s * swing
    legR.hip.rotation.x = s * swing
    // knees flex while the leg swings through, straighten at heel strike
    legL.knee.rotation.x = 0.08 + Math.max(0, Math.sin(t - 1.2)) * (0.75 + run * 0.5)
    legR.knee.rotation.x = 0.08 + Math.max(0, Math.sin(t - 1.2 + Math.PI)) * (0.75 + run * 0.5)
    armL.shoulder.rotation.x = s * (0.42 + run * 0.3)
    armR.shoulder.rotation.x = -s * (0.42 + run * 0.3)
    armL.shoulder.rotation.z = -0.06
    armR.shoulder.rotation.z = 0.06
    armL.elbow.rotation.x = -0.25 - run * 0.9 - Math.max(0, s) * 0.2
    armR.elbow.rotation.x = -0.25 - run * 0.9 - Math.max(0, -s) * 0.2
    body.position.y = Math.abs(Math.cos(t)) * 0.035 - 0.012
    chest.rotation.x = 0.04 + run * 0.12
    chest.rotation.y = s * 0.07
    head.rotation.x = -0.02 - run * 0.08
  } else if (props.mode === 'ride') {
    // astride a motorbike / bicycle: knees bent and apart, hands on bars
    legL.hip.rotation.x = legR.hip.rotation.x = -1.05
    legL.hip.rotation.z = 0.3
    legR.hip.rotation.z = -0.3
    legL.knee.rotation.x = legR.knee.rotation.x = 1.3
    armL.shoulder.rotation.x = armR.shoulder.rotation.x = -1.05
    armL.shoulder.rotation.z = -0.22
    armR.shoulder.rotation.z = 0.22
    armL.elbow.rotation.x = armR.elbow.rotation.x = -0.35
    body.position.y = 0
    chest.rotation.set(0.22, 0, 0)
    head.rotation.set(-0.15, 0, 0)
  } else if (props.mode === 'sit') {
    legL.hip.rotation.z = legR.hip.rotation.z = 0
    legL.hip.rotation.x = legR.hip.rotation.x = -1.45
    legL.knee.rotation.x = legR.knee.rotation.x = 1.45
    armL.shoulder.rotation.x = armR.shoulder.rotation.x = -0.6
    armL.elbow.rotation.x = armR.elbow.rotation.x = -0.6
    armL.shoulder.rotation.z = -0.15
    armR.shoulder.rotation.z = 0.15
    body.position.y = 0
    chest.rotation.set(0, 0, 0)
  } else {
    // idle: breathing, a slow weight shift, relaxed arms
    const e = elapsed + props.phase * 3.1
    const shift = Math.sin(e * 0.6) * 0.04
    legL.hip.rotation.x = legR.hip.rotation.x = 0
    legL.hip.rotation.z = legR.hip.rotation.z = 0
    legL.knee.rotation.x = 0.03 + Math.max(0, shift) * 1.5
    legR.knee.rotation.x = 0.03 + Math.max(0, -shift) * 1.5
    armL.shoulder.rotation.x = Math.sin(e * 1.3) * 0.03
    armR.shoulder.rotation.x = -Math.sin(e * 1.3) * 0.03
    armL.shoulder.rotation.z = -0.09
    armR.shoulder.rotation.z = 0.09
    armL.elbow.rotation.x = armR.elbow.rotation.x = -0.12
    body.position.y = -Math.abs(shift) * 0.2
    body.rotation.z = shift * 0.3
    chest.rotation.x = Math.sin(e * 1.9) * 0.012
    chest.rotation.y = 0
    head.rotation.y = Math.sin(e * 0.4) * 0.25
    head.rotation.x = 0
  }
})

onBeforeUnmount(() => {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
  })
  for (const m of Object.values(M)) m.dispose()
})
</script>

<template>
  <primitive :object="root" />
</template>
