<script setup lang="ts">
// SocialScenes - the 3D side of "people who matter" and social events:
//  * a date: your partner joins you and chats face to face
//  * the wedding owambe: canopy, aso-ebi crowd dancing around the couple,
//    naira notes raining ("spraying")
//  * dance battle at the bar: a rival dancer squares up to you
//  * 5-a-side football at the park: real ball physics with Rapier, four
//    team-mates vs five opponents, first to 3 goals
import * as THREE from 'three'
import { heightAt } from '~/utils/terrain'
import { INTERIOR_DROP } from '~/utils/kadunaExtras'
import { PARK_AREAS, PITCH } from '~/utils/parksShared'
import { hitsBuilding } from '~/utils/collision'
import { hashDist, roadHash } from '~/utils/kadunaExtras'
import { randomLook, type PersonLook } from '~/utils/people'
import type { Outfit } from '~/utils/outfits'
import { useInterior, usePlayerPose } from '~/composables/useControlsState'
import type { SceneState } from '~/utils/lifeShared'

const playerPos = useState<[number, number, number]>('kk_player_pos')
const facing = useState<number>('kk_player_facing', () => 0)
const interior = useInterior()
const pose = usePlayerPose()
const ui = useUiStore()

const scene = useState<SceneState>('kk_scene_social', () => ({ date: null, owambe: null, dance: null, football: null }))

const floorY = () => (interior.value.inside ? -INTERIOR_DROP : heightAt(playerPos.value[0], playerPos.value[2]))

// ------------------------------------------------------------ date
const datePos = ref<[number, number, number]>([0, 0, 0])
const dateYaw = ref(0)
const dateFemale = ref(true)
function onDate(e: Event) {
  const d = (e as CustomEvent).detail
  if (!d?.active) {
    scene.value.date = null
    return
  }
  scene.value.date = { name: d.name, place: d.place }
  dateFemale.value = d.female ?? true
  const f = facing.value
  const [px, , pz] = playerPos.value
  datePos.value = [px + Math.sin(f) * 1.4, floorY(), pz + Math.cos(f) * 1.4]
  dateYaw.value = f + Math.PI
}

// ------------------------------------------------------------ owambe
const ASO = ['#6b2fa0', '#d4a017', '#6b2fa0', '#d4a017', '#0e7c66']
const crowd = ref<Array<{ id: number; x: number; z: number; yaw: number; female: boolean; top: string }>>([])
const owambeAt = ref<[number, number, number]>([0, 0, 0])
const notes = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.3, 0.15),
  new THREE.MeshBasicMaterial({ color: '#b9e0a5', side: THREE.DoubleSide }),
  160
)
notes.visible = false
notes.frustumCulled = false
const noteSeed = Array.from({ length: 160 }, () => [Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 4, Math.random() * 6])
const canopy = new THREE.Group()
{
  const cloth = new THREE.Mesh(new THREE.ConeGeometry(9, 2.6, 4, 1, true), new THREE.MeshLambertMaterial({ color: '#f6f1e8', side: THREE.DoubleSide, transparent: true, opacity: 0.28, depthWrite: false }))
  cloth.position.y = 5.6
  cloth.rotation.y = Math.PI / 4
  canopy.add(cloth)
  const poleG = new THREE.CylinderGeometry(0.08, 0.08, 4.4)
  const poleM = new THREE.MeshLambertMaterial({ color: '#d4a017' })
  for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
    const p = new THREE.Mesh(poleG, poleM)
    p.position.set(x!, 2.2, z!)
    canopy.add(p)
  }
  canopy.visible = false
}
const owambeFemale = ref(true)
function onOwambe(e: Event) {
  const partner = (e as CustomEvent).detail?.partner ?? 'your partner'
  owambeFemale.value = (e as CustomEvent).detail?.female ?? true
  const guest = !!(e as CustomEvent).detail?.guest
  const [px, , pz] = playerPos.value
  const y = floorY()
  owambeAt.value = [px, y, pz]
  scene.value.owambe = { partner, until: performance.now() + 75_000 }
  crowd.value = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2
    const r = 3.6 + (i % 3) * 1.3
    return { id: 900 + i, x: px + Math.sin(a) * r, z: pz + Math.cos(a) * r, yaw: a + Math.PI, female: i % 2 === 0, top: ASO[i % ASO.length]! }
  })
  canopy.position.set(px, y, pz)
  canopy.visible = !interior.value.inside
  notes.visible = true
  pose.value = 'dance'
  ui.showToast(guest ? `🎉 Owambe for ${partner}! Dance and spray some k-sats.` : `🎉 Owambe! Everyone is spraying money for you and ${partner}.`, 'success')
}

// ------------------------------------------------------------ dance battle
const rivalPos = ref<[number, number, number]>([0, 0, 0])
const rivalYaw = ref(0)
function onDance(e: Event) {
  const d = (e as CustomEvent).detail
  if (!d?.active) {
    scene.value.dance = null
    if (pose.value === 'dance' && !scene.value.owambe) pose.value = null
    return
  }
  const f = facing.value
  const [px, , pz] = playerPos.value
  rivalPos.value = [px + Math.sin(f) * 2.4, floorY(), pz + Math.cos(f) * 2.4]
  rivalYaw.value = f + Math.PI
  scene.value.dance = { rival: d.rival ?? 'DJ Kabiru' }
  pose.value = 'dance'
}

// ------------------------------------------------------------ football (Rapier)
let RAPIER: any = null
let world: any = null
let ballBody: any = null
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }))
ball.castShadow = true
ball.visible = false
const pitch = new THREE.Group()
pitch.visible = false
const PW = 30 // length (x)
const PD = 18 // width (z)
const GOAL = 5
let pc = { x: 0, z: 0, y: 0 }
interface Baller { id: number; team: 0 | 1; x: number; z: number; hx: number; hz: number; yaw: number; moving: boolean; cool: number; female: boolean }
const ballers = ref<Baller[]>([])
const ballerRefs = new Map<number, THREE.Object3D>()
const setRef = (id: number) => (el: any) => {
  if (el) ballerRefs.set(id, el.value ?? el)
  else ballerRefs.delete(id)
}

function buildPitch() {
  pitch.clear()
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(PW + 4, PD + 4), new THREE.MeshLambertMaterial({ color: '#4f8a3a' }))
  lawn.rotation.x = -Math.PI / 2
  lawn.position.y = 0.02
  lawn.receiveShadow = true
  pitch.add(lawn)
  const line = new THREE.MeshBasicMaterial({ color: '#f4f4f0' })
  const add = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), line)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.04, z)
    pitch.add(m)
  }
  add(PW, 0.12, 0, -PD / 2)
  add(PW, 0.12, 0, PD / 2)
  add(0.12, PD, -PW / 2, 0)
  add(0.12, PD, PW / 2, 0)
  add(0.12, PD, 0, 0)
  const postM = new THREE.MeshStandardMaterial({ color: '#ffffff' })
  for (const side of [-1, 1]) {
    for (const zz of [-GOAL / 2, GOAL / 2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2), postM)
      p.position.set((side * PW) / 2, 1, zz)
      pitch.add(p)
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GOAL), postM)
    bar.rotation.x = Math.PI / 2
    bar.position.set((side * PW) / 2, 2, 0)
    pitch.add(bar)
    const net = new THREE.Mesh(new THREE.PlaneGeometry(GOAL, 2), new THREE.MeshBasicMaterial({ color: '#dddddd', transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
    net.rotation.y = Math.PI / 2
    net.position.set((side * (PW + 1.6)) / 2, 1, 0)
    pitch.add(net)
  }
}

function pitchSpot(px: number, pz: number, r: number): [number, number] {
  const ok = (cx: number, cz: number) => {
    for (let i = -PW / 2 - 3; i <= PW / 2 + 3; i += 3)
      for (let j = -PD / 2 - 2; j <= PD / 2 + 2; j += 3) {
        const x = cx + i
        const z = cz + j
        if (hitsBuilding(x, z, 0.8) || hashDist(roadHash(), x, z, 30) < 7 || Math.hypot(x - px, z - pz) < r + 1) return false
        if (Math.abs(heightAt(x, z) - heightAt(cx, cz)) > 0.6) return false
      }
    return true
  }
  for (let k = 0; k < 1500; k++) {
    const a = k * 2.399
    const d = r + PW / 2 + 2 + Math.sqrt(k) * 3
    const cx = px + Math.cos(a) * d
    const cz = pz + Math.sin(a) * d
    if (ok(cx, cz)) return [cx, cz]
  }
  return [px, pz]
}

async function onFootball() {
  if (scene.value.football) return
  const [px, , pz] = playerPos.value
  let best = PARK_AREAS[0]
  let bd = Infinity
  for (const p of PARK_AREAS) {
    const d = Math.hypot(p.x - px, p.z - pz)
    if (d < bd) (bd = d), (best = p)
  }
  if (!best || bd > best.r + 40) return ui.showToast('Go to a park to play 5-a-side.', 'info')
  if (!RAPIER) {
    RAPIER = (await import('@dimforge/rapier3d-compat')).default
    await RAPIER.init()
  }
  // the park lawns are small, so the pitch goes on the nearest open grass
  // beside the park: no buildings, roads, trees or houses on it
  const [fx, fz] = pitchSpot(best.x, best.z, best.r)
  pc = { x: fx, z: fz, y: heightAt(fx, fz) }
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  // ground + low boards around the pitch (with gaps for the goals)
  world.createCollider(RAPIER.ColliderDesc.cuboid(PW, 0.1, PD).setTranslation(0, -0.1, 0).setFriction(0.8))
  const wall = (hx: number, hz: number, x: number, z: number) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 1, hz).setTranslation(x, 1, z).setRestitution(0.6))
  wall(PW / 2 + 2, 0.2, 0, -PD / 2 - 0.2)
  wall(PW / 2 + 2, 0.2, 0, PD / 2 + 0.2)
  for (const side of [-1, 1]) {
    const seg = (PD - GOAL) / 4
    wall(0.2, seg, (side * (PW / 2 + 0.2)), -(GOAL / 2 + seg))
    wall(0.2, seg, (side * (PW / 2 + 0.2)), GOAL / 2 + seg)
    wall(0.2, GOAL / 2 + 0.2, side * (PW / 2 + 1.8), 0) // back of the net
  }
  ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.4, 0).setLinearDamping(0.55).setAngularDamping(0.4).setCcdEnabled(true))
  world.createCollider(RAPIER.ColliderDesc.ball(0.22).setRestitution(0.65).setFriction(0.6).setDensity(0.6), ballBody)
  buildPitch()
  pitch.position.set(pc.x, pc.y, pc.z)
  pitch.visible = true
  ball.visible = true
  const list: Baller[] = []
  // team 0 (yours) attacks +x; you are the fifth player
  const homes0: [number, number][] = [[-14, 0], [-7, -5], [-7, 5], [-2, 0]]
  const homes1: [number, number][] = [[14, 0], [7, -5], [7, 5], [2, -3], [2, 3]]
  homes0.forEach(([x, z], i) => list.push({ id: i, team: 0, x, z, hx: x, hz: z, yaw: Math.PI / 2, moving: false, cool: 0, female: i === 2 }))
  homes1.forEach(([x, z], i) => list.push({ id: 10 + i, team: 1, x, z, hx: x, hz: z, yaw: -Math.PI / 2, moving: false, cool: 0, female: i === 1 }))
  ballers.value = list
  scene.value.football = { score: [0, 0], until: performance.now() + 4 * 60_000, park: best.name, cx: pc.x, cz: pc.z }
  // drop you at your own half
  PITCH.active = true
  PITCH.x = pc.x
  PITCH.z = pc.z
  PITCH.hw = PW / 2 + 2
  PITCH.hd = PD / 2 + 2
  ui.showToast(`⚽ 5-a-side beside ${best.name}! Run onto the pitch - run into the ball to kick it. First to 3.`, 'success')
}
function endFootball(msg?: string) {
  if (!scene.value.football) return
  const [a, b] = scene.value.football.score
  ui.showToast(msg ?? (a > b ? `Full time: you won ${a}-${b}! 🏆` : a === b ? `Full time: ${a}-${b} draw.` : `Full time: lost ${a}-${b}.`), a > b ? 'success' : 'info')
  scene.value.football = null
  PITCH.active = false
  pitch.visible = false
  ball.visible = false
  ballers.value = []
  world?.free?.()
  world = null
  ballBody = null
}
function resetBall(towards: number) {
  ballBody.setTranslation({ x: 0, y: 0.4, z: 0 }, true)
  ballBody.setLinvel({ x: towards * 0.01, y: 0, z: 0 }, true)
  ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
  for (const p of toRaw(ballers.value)) {
    p.x = p.hx
    p.z = p.hz
  }
}
function kick(fromX: number, fromZ: number, dirX: number, dirZ: number, power: number) {
  const l = Math.hypot(dirX, dirZ) || 1
  ballBody.applyImpulse({ x: (dirX / l) * power, y: power * 0.18, z: (dirZ / l) * power }, true)
}

function stepFootball(dt: number) {
  if (!world || !ballBody || !scene.value.football) return
  const fb = scene.value.football
  world.timestep = Math.min(dt, 1 / 30)
  world.step()
  const t = ballBody.translation()
  ball.position.set(pc.x + t.x, pc.y + t.y, pc.z + t.z)
  const r = ballBody.rotation()
  ball.quaternion.set(r.x, r.y, r.z, r.w)
  // goals
  if (Math.abs(t.z) < GOAL / 2 && Math.abs(t.x) > PW / 2 + 0.3) {
    const forUs = t.x > 0
    fb.score[forUs ? 0 : 1]++
    ui.showToast(forUs ? `GOAL! ⚽ ${fb.score[0]}-${fb.score[1]}` : `They scored. ${fb.score[0]}-${fb.score[1]}`, forUs ? 'success' : 'info')
    if (fb.score[0] >= 3 || fb.score[1] >= 3) return endFootball()
    resetBall(forUs ? -1 : 1)
    return
  }
  if (performance.now() > fb.until) return endFootball()
  // you: run into the ball to kick it the way you face
  const lx = playerPos.value[0] - pc.x
  const lz = playerPos.value[2] - pc.z
  if (Math.hypot(lx - t.x, lz - t.z) < 0.9 && t.y < 0.6) {
    const f = facing.value
    kick(lx, lz, Math.sin(f), Math.cos(f), 2.4)
  }
  // AI: the nearest player of each team chases; the rest hold shape
  for (const team of [0, 1] as const) {
    const all = toRaw(ballers.value)
    const mates = all.filter((p) => p.team === team)
    let chaser = mates[0]!
    let cd = Infinity
    for (const p of mates) {
      const d = Math.hypot(p.x - t.x, p.z - t.z)
      if (d < cd) (cd = d), (chaser = p)
    }
    const goalX = team === 0 ? PW / 2 : -PW / 2
    for (const p of mates) {
      p.cool = Math.max(0, p.cool - dt)
      let tx: number
      let tz: number
      if (p === chaser) {
        // approach from behind the ball relative to the goal
        const gx = goalX - t.x
        const gz = -t.z
        const gl = Math.hypot(gx, gz) || 1
        tx = t.x - (gx / gl) * 0.6
        tz = t.z - (gz / gl) * 0.6
      } else {
        tx = p.hx + (t.x - p.hx) * 0.3
        tz = p.hz + (t.z - p.hz) * 0.3
      }
      const dx = tx - p.x
      const dz = tz - p.z
      const d = Math.hypot(dx, dz)
      const sp = p === chaser ? 5.2 : 3
      const mv = d > 0.3
      if (mv !== p.moving) ballers.value[all.indexOf(p)]!.moving = mv // reactive only on change
      if (mv) {
        p.x += (dx / d) * Math.min(d, sp * dt)
        p.z += (dz / d) * Math.min(d, sp * dt)
        p.yaw = Math.atan2(dx, dz)
      }
      if (p === chaser && Math.hypot(p.x - t.x, p.z - t.z) < 0.85 && p.cool === 0 && t.y < 0.6) {
        const shoot = Math.abs(goalX - t.x) < 12
        kick(p.x, p.z, goalX - t.x, (Math.random() - 0.5) * (shoot ? GOAL : 8) - t.z, shoot ? 3.2 : 1.6)
        p.cool = 0.6
      }
      const o = ballerRefs.get(p.id)
      if (o) {
        o.position.set(pc.x + p.x, pc.y, pc.z + p.z)
        o.rotation.y = p.yaw
      }
    }
  }
}

// ------------------------------------------------------------ loop
let last = performance.now()
const { onBeforeRender } = useLoop()
const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const e3 = new THREE.Euler()
const v3 = new THREE.Vector3()
const one = new THREE.Vector3(1, 1, 1)
onBeforeRender(() => {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  stepFootball(dt)
  const ow = scene.value.owambe
  if (ow) {
    if (now > ow.until) {
      scene.value.owambe = null
      crowd.value = []
      canopy.visible = false
      notes.visible = false
      if (pose.value === 'dance') pose.value = null
    } else {
      const [ox, oy, oz] = owambeAt.value
      noteSeed.forEach((s, i) => {
        const fall = ((now / 1000) * 0.9 + s[3]!) % 4
        v3.set(ox + s[0]!, oy + 3.2 - fall * 0.8, oz + s[1]!)
        e3.set(now / 300 + i, now / 500 + i * 0.3, 0)
        q.setFromEuler(e3)
        m4.compose(v3, q, one)
        notes.setMatrixAt(i, m4)
      })
      notes.instanceMatrix.needsUpdate = true
    }
  }
})

onMounted(() => {
  window.addEventListener('kk-date', onDate)
  window.addEventListener('kk-owambe', onOwambe)
  window.addEventListener('kk-dance-battle', onDance)
  window.addEventListener('kk-football', onFootball)
  window.addEventListener('kk-football-end', onFootballEnd)
})
function onFootballEnd() {
  endFootball('You left the match.')
}
onBeforeUnmount(() => {
  window.removeEventListener('kk-date', onDate)
  window.removeEventListener('kk-owambe', onOwambe)
  window.removeEventListener('kk-dance-battle', onDance)
  window.removeEventListener('kk-football', onFootball)
  window.removeEventListener('kk-football-end', onFootballEnd)
  endFootball('')
})
if (import.meta.dev && typeof window !== 'undefined') {
  ;(window as any).__kk_social = () => ({ ...scene.value, ball: ballBody ? ballBody.translation() : null, ballers: ballers.value.length })
}
/** an everyday person (utils/people) wearing what the scene asks for */
const dressed = (seed: number, female: boolean, over: Partial<Outfit> = {}): PersonLook => {
  const b = randomLook(seed, female)
  return { ...b, outfit: { ...b.outfit, ...over } }
}
</script>

<template>
  <primitive :object="notes" />
  <primitive :object="canopy" />
  <primitive :object="pitch" />
  <primitive :object="ball" />

  <!-- date partner -->
  <TresGroup v-if="scene.date" :position="datePos" :rotation-y="dateYaw">
    <CharacterAvatar :key="`date-${scene.date.name}-${dateFemale}`" :person="dressed(77, dateFemale, dateFemale ? { top: 'shirt', topColor: '#b0306a', bottom: 'skirt' } : { top: 'shirt', topColor: '#1f3b5a', bottom: 'trousers' })" :mode="'talk' as any" />
  </TresGroup>

  <!-- dance battle rival -->
  <TresGroup v-if="scene.dance" :position="rivalPos" :rotation-y="rivalYaw">
    <CharacterAvatar :person="dressed(55, false, { top: 'tee', topColor: '#e8b923', bottom: 'jeans', bottomColor: '#1b1b1b' })" :mode="'dance' as any" :phase="0.7" />
  </TresGroup>

  <!-- owambe crowd in aso-ebi -->
  <TresGroup v-for="c in crowd" :key="c.id" :position="[c.x, owambeAt[1], c.z]" :rotation-y="c.yaw">
    <CharacterAvatar :person="dressed(c.id, c.female, { top: 'shirt', topColor: c.top, ...(c.female ? { bottom: 'skirt', bottomColor: c.top } : {}) })" :mode="'dance' as any" :phase="(c.id % 7) * 0.5" />
  </TresGroup>
  <TresGroup v-if="scene.owambe" :position="[owambeAt[0] + 1.1, owambeAt[1], owambeAt[2]]" :rotation-y="-Math.PI / 2">
    <CharacterAvatar :key="`owambe-${scene.owambe.partner}-${owambeFemale}`" :person="dressed(88, owambeFemale, { top: 'shirt', topColor: '#d4a017', bottom: owambeFemale ? 'skirt' : 'trousers', bottomColor: '#d4a017' })" :mode="'dance' as any" />
  </TresGroup>

  <!-- footballers: green bibs vs red bibs -->
  <TresGroup v-for="p in ballers" :key="p.id" :ref="setRef(p.id)" :position="[pc.x + p.hx, pc.y, pc.z + p.hz]">
    <CharacterAvatar :person="dressed(300 + p.id, p.female, { top: 'tee', topColor: p.team === 0 ? '#1aa34a' : '#c81d25', bottom: 'shorts', bottomColor: '#1b1b1b', shoes: 'sneakers' })" :mode="(p.moving ? 'walk' : 'idle') as any" :gait-speed="12" />
  </TresGroup>
</template>
