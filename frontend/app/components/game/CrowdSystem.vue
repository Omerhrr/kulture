<script setup lang="ts">
// CrowdSystem v3 - the life of the city, now with street smarts:
//   - pedestrians walk the sidewalks (never the tarmac)
//   - they cross only at zebra crossings, waiting for a gap in traffic
//   - they keep out of walls, give way to you, and never overlap each other
//   - they dodge fast vehicles, including the one you are driving
//   - stop next to anyone and a "Talk" prompt appears with a local line
// Every person is drawn through instanced meshes with real faces (eyes,
// brows, nose, mouth), hair, hijabs and wrappers, so the crowd reads human
// at street distance while costing a couple of dozen draw calls.
import * as THREE from 'three'
import { BAKE } from '~/utils/kaduna'
import { SITES, hash01 } from '~/utils/kadunaExtras'
import { crosswalks, type Crosswalk } from '~/utils/kadunaLighting'
import { collidesRadius } from '~/utils/collision'
import { laneBlocked, threatNear, trafficProbe } from '~/utils/trafficProbe'
import { pedRegistry, pedRegistryPush, pedRegistryReset, pedName, pedLine, pedClock, type PedKind } from '~/utils/peds'
import { useIsTouch } from '~/composables/useControlsState'

const isTouch = useIsTouch()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const clockHour = useState<number>('kk_hour', () => 8.4)
const pedPrompt = useState<{ id: number; name: string; kind: PedKind } | null>('kk_ped_prompt', () => null)
const ui = useUiStore()

// ---------------------------------------------------------------- routes
interface Route {
  pts: Float32Array
  cum: Float32Array
  total: number
  mid: [number, number]
  rw: number
}

const routes: Route[] = []
for (const r of BAKE.roads) {
  if (r.pts.length < 2) continue
  const flat = new Float32Array(r.pts.length * 2)
  const cum = new Float32Array(r.pts.length)
  let total = 0
  for (let i = 0; i < r.pts.length; i++) {
    flat[i * 2] = r.pts[i][0]
    flat[i * 2 + 1] = r.pts[i][1]
    if (i > 0) total += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1])
    cum[i] = total
  }
  const mid = r.pts[Math.floor(r.pts.length / 2)]
  routes.push({ pts: flat, cum, total, mid: [mid[0], mid[1]], rw: r.class === 'trunk' ? 3.2 : r.class === 'primary' ? 2.6 : 1.8 })
}
routes.sort((a, b) => a.total - b.total)
const walkable = routes.filter((r) => r.total > 30)

function routePoint(rt: Route, s: number, out: { x: number; z: number; fx: number; fz: number }) {
  const cum = rt.cum
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= s) lo = mid
    else hi = mid
  }
  const ax = rt.pts[lo * 2]
  const az = rt.pts[lo * 2 + 1]
  const bx = rt.pts[(lo + 1) * 2]
  const bz = rt.pts[(lo + 1) * 2 + 1]
  const segLen = cum[lo + 1] - cum[lo] || 1
  const t = Math.min(1, (s - cum[lo]) / segLen)
  const fx = (bx - ax) / segLen
  const fz = (bz - az) / segLen
  out.x = ax + (bx - ax) * t
  out.z = az + (bz - az) * t
  out.fx = fx
  out.fz = fz
}

/** Nearest walkable route to a point (used after crossing the street). */
function nearestRoute(x: number, z: number): Route | null {
  let best: Route | null = null
  let bestD = Infinity
  for (const rt of walkable) {
    const d = Math.hypot(rt.mid[0] - x, rt.mid[1] - z)
    if (d < bestD) {
      bestD = d
      best = rt
    }
  }
  return best
}

// ---------------------------------------------------------------- people
type Kind = PedKind
type Phase = 'walk' | 'toCross' | 'wait' | 'cross'
interface Ped {
  kind: Kind
  route: Route | null
  s: number
  dir: 1 | -1
  speed: number
  phase: number
  x: number
  z: number
  heading: number
  ax: number
  az: number
  orbit: number
  swing: number
  tx: number
  tz: number
  female: boolean
  kid: boolean
  height: number
  talking: number
  // crossing state machine
  stage: Phase
  cw: Crosswalk | null
  ex: number
  ez: number
  crossTimer: number
  flee: number
  id: number
}

const N_WALK = isTouch.value ? 20 : 36
const N_HAWK = isTouch.value ? 6 : 10
const N_VEND = isTouch.value ? 10 : 14
const N_WORK = isTouch.value ? 4 : 6
const N_KID = isTouch.value ? 4 : 6
const N_SHOP = isTouch.value ? 6 : 10
const TOTAL = N_WALK + N_HAWK + N_VEND + N_WORK + N_KID + N_SHOP

const CROSSWALKS = crosswalks()
const SIDEWALK = 1.35 // walk line out from the asphalt edge

const peds: Ped[] = []
const tmp = { x: 0, z: 0, fx: 0, fz: 0 }

function seedWalker(p: Ped, kind: Kind) {
  const rt = walkable[Math.floor(Math.random() * walkable.length)]
  p.kind = kind
  p.route = rt
  p.s = Math.random() * rt.total
  p.dir = Math.random() < 0.5 ? 1 : -1
  p.speed = kind === 'hawker' ? 1.1 + Math.random() * 0.5 : 1.5 + Math.random() * 1.1
  p.stage = 'walk'
  p.cw = null
  p.crossTimer = 7 + Math.random() * 14
}

const market = BAKE.landmarks.find((l) => l.kind === 'market')!
const vendorSpots: Array<[number, number]> = []
for (let r = 0; r < 4 && vendorSpots.length < N_VEND; r++) {
  for (let c = 0; c < 6 && vendorSpots.length < N_VEND; c++) {
    if ((r + c) % 2) continue
    vendorSpots.push([market.x - 21 + c * 8.4, market.z - 12 + r * 8 + 4.7])
  }
}
const park = BAKE.landmarks.find((l) => l.kind === 'park')!
const PITCH = [park.x - 24, park.z + 4]

let seedIdx = 0
for (let i = 0; i < TOTAL; i++) {
  seedIdx++
  const female = Math.random() < 0.46
  const kid = i >= N_WALK + N_HAWK + N_VEND + N_WORK && i < N_WALK + N_HAWK + N_VEND + N_WORK + N_KID
  const p: Ped = {
    kind: 'walker',
    route: null,
    s: 0,
    dir: 1,
    speed: 1.6,
    phase: Math.random() * 10,
    x: 0,
    z: 0,
    heading: 0,
    ax: 0,
    az: 0,
    orbit: 0,
    swing: Math.random() * 6,
    female,
    kid,
    height: kid ? 0.68 + Math.random() * 0.1 : 0.94 + Math.random() * 0.12,
    talking: 0,
    stage: 'walk',
    cw: null,
    ex: 0,
    ez: 0,
    crossTimer: 7 + Math.random() * 14,
    flee: 0,
    id: i
  }
  if (i < N_WALK + N_HAWK) {
    seedWalker(p, i < N_WALK ? 'walker' : 'hawker')
  } else if (i < N_WALK + N_HAWK + N_VEND) {
    const k = i - N_WALK - N_HAWK
    const [vx, vz] = vendorSpots[k % vendorSpots.length]
    p.kind = 'vendor'
    p.ax = vx
    p.az = vz
    p.heading = Math.PI + hash01(vx, vz) - 0.5
  } else if (i < N_WALK + N_HAWK + N_VEND + N_WORK) {
    const k = i - N_WALK - N_HAWK - N_VEND
    const site = SITES[k % Math.max(1, SITES.length)]
    p.kind = 'worker'
    p.ax = site.x - 5 + (k % 3) * 4
    p.az = site.z + 6.6
    p.heading = Math.PI
  } else if (i < N_WALK + N_HAWK + N_VEND + N_WORK + N_KID) {
    const k = i - N_WALK - N_HAWK - N_VEND - N_WORK
    p.kind = 'kid'
    p.ax = PITCH[0]
    p.az = PITCH[1]
    p.orbit = 4 + k * 1.4
    p.speed = 2.6 + k * 0.35
    p.phase = (k / N_KID) * Math.PI * 2
  } else {
    p.kind = 'shopper'
    p.speed = 1.1 + Math.random() * 0.6
    p.tx = market.x + (Math.random() - 0.5) * 44
    p.tz = market.z + (Math.random() - 0.5) * 30
    p.x = p.tx
    p.z = p.tz
    pickShopperTarget(p)
  }
  peds.push(p)
}

function pickShopperTarget(p: Ped) {
  p.tx = market.x + (Math.random() - 0.5) * 46
  p.tz = market.z + (Math.random() - 0.5) * 32
}

// ---------------------------------------------------------------- meshes
const groupRef = ref<THREE.Group | null>(null)
const colors = {
  shirts: ['#b8433a', '#3f7d5b', '#3f6fae', '#e8b84b', '#7a4a8a', '#c47a52', '#2e7d5b', '#a84a6a', '#4a6a8a', '#d8c23c'],
  trousers: ['#2b3440', '#3a3f4a', '#4a3b2f', '#22303a', '#52443a'],
  wrappers: ['#8a3a5a', '#3a6a8a', '#c47a2a', '#5a8a3a', '#8a5aa8', '#a84a3a', '#2a7a6a'],
  skins: ['#8a5a3b', '#6b4226', '#9c6b45', '#7a4a2c', '#a3744e'],
  hair: ['#17141a', '#241c14', '#0e0c10', '#33241a'],
  goods: ['#e8b84b', '#c94a3a', '#3f7d5b', '#b86a2a', '#d86a8a']
}
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

let torsoM: THREE.InstancedMesh | null = null
let headM: THREE.InstancedMesh | null = null
let legM: THREE.InstancedMesh | null = null
let armM: THREE.InstancedMesh | null = null
let trayM: THREE.InstancedMesh | null = null
// face + dress meshes
let eyesM: THREE.InstancedMesh | null = null
let pupilsM: THREE.InstancedMesh | null = null
let browM: THREE.InstancedMesh | null = null
let noseM: THREE.InstancedMesh | null = null
let mouthM: THREE.InstancedMesh | null = null
let hairM: THREE.InstancedMesh | null = null
let hijabM: THREE.InstancedMesh | null = null
let skirtM: THREE.InstancedMesh | null = null
const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshStandardMaterial({ color: '#e8e4d8', roughness: 0.6 }))

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geos = list.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g
    if (flat !== g) g.dispose()
    return flat
  })
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const pos = new Float32Array(total * 3)
  let off = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, off)
    off += g.attributes.position.count * 3
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.computeVertexNormals()
  return out
}

onMounted(() => {
  const g = groupRef.value
  if (!g) return

  const torsoGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.72, 8)
  torsoGeo.translate(0, 1.12, 0)
  const headGeo = new THREE.SphereGeometry(0.24, 10, 8)
  headGeo.translate(0, 1.78, 0)
  const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.19)
  legGeo.translate(0, -0.39, 0)
  const armGeo = new THREE.BoxGeometry(0.13, 0.6, 0.15)
  armGeo.translate(0, -0.3, 0)
  const trayGeo = new THREE.BoxGeometry(0.55, 0.09, 0.55)
  trayGeo.translate(0, 2.18, 0)
  const goodsGeo = new THREE.BoxGeometry(0.34, 0.18, 0.34)
  goodsGeo.translate(0, 2.31, 0)
  const trayFull = mergeTray(trayGeo, goodsGeo)

  function mergeTray(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
    const ga = a.index ? a.toNonIndexed() : a
    const gb = b.index ? b.toNonIndexed() : b
    const total = ga.attributes.position.count + gb.attributes.position.count
    const pos = new Float32Array(total * 3)
    pos.set(ga.attributes.position.array as Float32Array, 0)
    pos.set(gb.attributes.position.array as Float32Array, ga.attributes.position.count * 3)
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    out.computeVertexNormals()
    a.dispose()
    b.dispose()
    ga.dispose()
    gb.dispose()
    return out
  }

  // ---- face geometries (front = +z, matching the heading convention)
  const eyeL = new THREE.SphereGeometry(0.052, 7, 6)
  eyeL.translate(-0.088, 1.845, 0.195)
  const eyeR = new THREE.SphereGeometry(0.052, 7, 6)
  eyeR.translate(0.088, 1.845, 0.195)
  const eyesGeo = mergeGeos([eyeL, eyeR])
  const pupL = new THREE.SphereGeometry(0.026, 6, 5)
  pupL.translate(-0.088, 1.845, 0.238)
  const pupR = new THREE.SphereGeometry(0.026, 6, 5)
  pupR.translate(0.088, 1.845, 0.238)
  const pupilsGeo = mergeGeos([pupL, pupR])
  const browL = new THREE.BoxGeometry(0.1, 0.022, 0.03)
  browL.translate(-0.088, 1.905, 0.205)
  const browR = new THREE.BoxGeometry(0.1, 0.022, 0.03)
  browR.translate(0.088, 1.905, 0.205)
  const browGeo = mergeGeos([browL, browR])
  const noseGeo = new THREE.ConeGeometry(0.038, 0.09, 5)
  noseGeo.rotateX(Math.PI / 2)
  noseGeo.translate(0, 1.785, 0.235)
  const mouthGeo = new THREE.BoxGeometry(0.11, 0.026, 0.03)
  mouthGeo.translate(0, 1.7, 0.212)
  // hair: cap shell + back volume (hidden for hijab wearers)
  const hairCap = new THREE.SphereGeometry(0.255, 10, 8, 0, Math.PI * 2, 0, 1.35)
  hairCap.translate(0, 1.86, -0.015)
  const hairBack = new THREE.SphereGeometry(0.19, 8, 6)
  hairBack.scale(1, 1.15, 0.75)
  hairBack.translate(0, 1.74, -0.12)
  const hairGeo = mergeGeos([hairCap, hairBack])
  const hijabGeo = new THREE.SphereGeometry(0.3, 11, 9)
  hijabGeo.translate(0, 1.8, 0)
  const skirtGeo = new THREE.ConeGeometry(0.34, 0.85, 9, 1, true)
  skirtGeo.translate(0, 0.62, 0)

  const plain = (color: string) => new THREE.MeshLambertMaterial({ color })
  torsoM = new THREE.InstancedMesh(torsoGeo, new THREE.MeshLambertMaterial(), TOTAL)
  headM = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), TOTAL)
  legM = new THREE.InstancedMesh(legGeo, new THREE.MeshLambertMaterial(), TOTAL * 2)
  armM = new THREE.InstancedMesh(armGeo, new THREE.MeshLambertMaterial(), TOTAL * 2)
  trayM = new THREE.InstancedMesh(trayFull, new THREE.MeshLambertMaterial(), TOTAL)
  eyesM = new THREE.InstancedMesh(eyesGeo, plain('#f2f0ea'), TOTAL)
  pupilsM = new THREE.InstancedMesh(pupilsGeo, plain('#14100e'), TOTAL)
  browM = new THREE.InstancedMesh(browGeo, new THREE.MeshLambertMaterial(), TOTAL)
  noseM = new THREE.InstancedMesh(noseGeo, new THREE.MeshLambertMaterial(), TOTAL)
  mouthM = new THREE.InstancedMesh(mouthGeo, plain('#5a3028'), TOTAL)
  hairM = new THREE.InstancedMesh(hairGeo, new THREE.MeshLambertMaterial(), TOTAL)
  hijabM = new THREE.InstancedMesh(hijabGeo, new THREE.MeshLambertMaterial(), TOTAL)
  skirtM = new THREE.InstancedMesh(skirtGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), TOTAL)

  torsoM.castShadow = headM.castShadow = legM.castShadow = true
  const all = [torsoM, headM, legM, armM, trayM, eyesM, pupilsM, browM, noseM, mouthM, hairM, hijabM, skirtM]
  for (const m of all) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    g.add(m)
  }
  ball.castShadow = true
  g.add(ball)

  const c = new THREE.Color()
  for (let i = 0; i < TOTAL; i++) {
    const p = peds[i]
    const shirt = pick(colors.shirts)
    const trouser = pick(colors.trousers)
    const skin = pick(colors.skins)
    const hair = pick(colors.hair)
    c.set(shirt)
    torsoM!.setColorAt(i, c)
    c.set(skin)
    headM!.setColorAt(i, c)
    noseM!.setColorAt(i, c)
    for (let k = 0; k < 2; k++) {
      legM!.setColorAt(i * 2 + k, c.set(trouser))
      armM!.setColorAt(i * 2 + k, c.set(shirt))
    }
    c.set(pick(colors.goods))
    trayM!.setColorAt(i, c)
    c.set(hair)
    browM!.setColorAt(i, c)
    hairM!.setColorAt(i, c)
    c.set(p.female ? pick(colors.wrappers) : trouser)
    skirtM!.setColorAt(i, c)
    c.set(pick(colors.shirts))
    hijabM!.setColorAt(i, c)
  }
  for (const m of all) if (m.instanceColor) m.instanceColor.needsUpdate = true
})

onBeforeUnmount(() => {
  for (const m of [torsoM, headM, legM, armM, trayM, eyesM, pupilsM, browM, noseM, mouthM, hairM, hijabM, skirtM]) m?.dispose()
})

// ---------------------------------------------------------------- update
const rootM = new THREE.Matrix4()
const localM = new THREE.Matrix4()
const partM = new THREE.Matrix4()
const posV = new THREE.Vector3()
const scaleV = new THREE.Vector3()
const oneV = new THREE.Vector3(1, 1, 1)
const q = new THREE.Quaternion()
const eul = new THREE.Euler()
const ZERO = new THREE.Vector3(0, 0, 0)

function setPart(mesh: THREE.InstancedMesh, i: number, root: THREE.Matrix4, px: number, py: number, pz: number, rx = 0) {
  localM.compose(posV.set(px, py, pz), q.setFromEuler(eul.set(rx, 0, 0)), oneV)
  partM.multiplyMatrices(root, localM)
  mesh.setMatrixAt(i, partM)
}

/** Move with wall sliding; returns false when fully blocked. */
function slideMove(p: Ped, mx: number, mz: number): boolean {
  const r = 0.34
  if (!collidesRadius(p.x + mx, p.z + mz, r)) {
    p.x += mx
    p.z += mz
    return true
  }
  if (mx !== 0 && !collidesRadius(p.x + mx, p.z, r)) {
    p.x += mx
    return true
  }
  if (mz !== 0 && !collidesRadius(p.x, p.z + mz, r)) {
    p.z += mz
    return true
  }
  return false
}

function startCrossing(p: Ped) {
  // nearest crossing to the current position
  let best: Crosswalk | null = null
  let bestD = Infinity
  for (const cw of CROSSWALKS) {
    const d = Math.hypot(cw.x - p.x, cw.z - p.z)
    if (d < bestD) {
      bestD = d
      best = cw
    }
  }
  if (!best || bestD > 90) {
    p.crossTimer = 8 + Math.random() * 10
    return
  }
  const reach = best.rw / 2 + 2.1
  const e1x = best.x - best.nx * reach
  const e1z = best.z - best.nz * reach
  const e2x = best.x + best.nx * reach
  const e2z = best.z + best.nz * reach
  const d1 = Math.hypot(e1x - p.x, e1z - p.z)
  const d2 = Math.hypot(e2x - p.x, e2z - p.z)
  p.cw = best
  p.stage = 'toCross'
  if (d1 <= d2) {
    p.ex = e1x
    p.ez = e1z
  } else {
    p.ex = e2x
    p.ez = e2z
  }
}

let recycleTimer = 0
let promptTimer = 0
let lastElapsed = 0

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  if (!torsoM || !headM || !legM || !armM || !trayM || !eyesM || !pupilsM || !browM || !noseM || !mouthM || !hairM || !hijabM || !skirtM) return
  const dt = Math.min(delta || 0.016, 0.1)
  lastElapsed = elapsed
  pedClock.hour = clockHour.value
  const px = playerPos.value[0]
  const pz = playerPos.value[2]

  // recycle far walkers onto streets near the player
  recycleTimer += dt
  if (recycleTimer > 0.6) {
    recycleTimer = 0
    for (const p of peds) {
      if (p.kind !== 'walker' && p.kind !== 'hawker') continue
      if (!p.route) continue
      if (Math.hypot(p.x - px, p.z - pz) < 430) continue
      let best: Route | null = null
      let bestD = Infinity
      for (let t = 0; t < 8; t++) {
        const rt = walkable[Math.floor(Math.random() * walkable.length)]
        const d = Math.hypot(rt.mid[0] - px, rt.mid[1] - pz)
        if (d < bestD) {
          bestD = d
          best = rt
        }
      }
      if (best && bestD < 340) {
        p.route = best
        p.s = Math.random() * best.total
        p.dir = Math.random() < 0.5 ? 1 : -1
        p.stage = 'walk'
        p.cw = null
      }
    }
  }

  // ------------------------------------------------- behavior per ped
  for (const p of peds) {
    // talking people stand still and face you
    if (p.talking > 0) {
      p.talking -= dt
      p.heading = Math.atan2(px - p.x, pz - p.z)
      p.swing = 0
      continue
    }

    // dodge fast traffic (ambient cars or the player's vehicle)
    const threat = threatNear(p.x, p.z, p.stage === 'cross' ? 5.5 : 4.5)
    if (threat > 0.22) {
      // step back from the road center while it passes
      if (p.cw && p.stage !== 'walk') {
        const away = Math.sign((p.x - p.cw.x) * p.cw.nx + (p.z - p.cw.z) * p.cw.nz) || 1
        const step = threat * 3.2 * dt
        slideMove(p, p.cw.nx * away * step, p.cw.nz * away * step)
        p.swing += dt * 14
        continue
      }
      p.flee = 0.5
    }
    if (p.flee > 0) {
      p.flee -= dt
      const fx = p.x - px
      const fz = p.z - pz
      const d = Math.hypot(fx, fz) || 1
      slideMove(p, (fx / d) * 3.4 * dt, (fz / d) * 3.4 * dt)
      p.heading = Math.atan2(fx, fz)
      p.swing += dt * 12
      continue
    }

    if (p.kind === 'walker' || p.kind === 'hawker') {
      if (p.stage === 'walk') {
        p.s += p.speed * p.dir * dt
        if (p.route) {
          if (p.s >= p.route.total) {
            p.s = p.route.total - 0.1
            p.dir = -1
          } else if (p.s <= 0) {
            p.s = 0.1
            p.dir = 1
          }
          routePoint(p.route, p.s, tmp)
          const off = p.route.rw / 2 + SIDEWALK
          const nx = tmp.x + -tmp.fz * off * p.dir
          const nz = tmp.z + tmp.fx * off * p.dir
          const mx = nx - p.x
          const mz = nz - p.z
          if (!slideMove(p, mx, mz)) {
            // wall or obstacle blocks the sidewalk: turn around
            p.dir = (p.dir === 1 ? -1 : 1) as 1 | -1
          }
          p.heading = Math.atan2(tmp.fx * p.dir, tmp.fz * p.dir)
        }
        p.crossTimer -= dt
        if (p.crossTimer <= 0) startCrossing(p)
      } else if (p.stage === 'toCross') {
        const dx = p.ex - p.x
        const dz = p.ez - p.z
        const d = Math.hypot(dx, dz)
        if (d < 0.35) {
          p.stage = 'wait'
        } else {
          slideMove(p, (dx / d) * p.speed * dt, (dz / d) * p.speed * dt)
          p.heading = Math.atan2(dx, dz)
          p.swing += dt * p.speed * 5.6
        }
      } else if (p.stage === 'wait') {
        // stand at the curb, face the road, wait for a gap
        p.swing = 0
        const cw = p.cw!
        p.heading = Math.atan2(-cw.nx * (p.ex > cw.x ? 1 : -1), -cw.nz * (p.ez > cw.z ? 1 : -1))
        const blocked = laneBlocked(cw.x, cw.z, 15)
        if (blocked < 0 || blocked < 7) p.stage = 'cross'
      } else if (p.stage === 'cross') {
        const cw = p.cw!
        const reach = cw.rw / 2 + 2.1
        const side = (p.ex - cw.x) * cw.nx + (p.ez - cw.z) * cw.nz > 0 ? 1 : -1
        const tx = cw.x - cw.nx * reach * side
        const tz = cw.z - cw.nz * reach * side
        const dx = tx - p.x
        const dz = tz - p.z
        const d = Math.hypot(dx, dz)
        if (d < 0.4) {
          // reached the far curb
          p.stage = 'walk'
          p.cw = null
          p.crossTimer = 9 + Math.random() * 16
          const rt = nearestRoute(p.x, p.z)
          if (rt) {
            p.route = rt
            p.s = Math.random() * rt.total
            p.dir = Math.random() < 0.5 ? 1 : -1
          }
        } else {
          slideMove(p, (dx / d) * p.speed * 1.25 * dt, (dz / d) * p.speed * 1.25 * dt)
          p.heading = Math.atan2(dx, dz)
          p.swing += dt * p.speed * 6.6
        }
      }
    } else if (p.kind === 'vendor') {
      p.x = p.ax
      p.z = p.az
      p.heading = Math.PI + Math.sin(elapsed * 0.4 + p.phase) * 0.5
      p.swing = 0
    } else if (p.kind === 'shopper') {
      const dx = p.tx - p.x
      const dz = p.tz - p.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.8) {
        pickShopperTarget(p)
      } else {
        const mx = (dx / dist) * p.speed * dt
        const mz = (dz / dist) * p.speed * dt
        if (!slideMove(p, mx, mz)) pickShopperTarget(p)
        p.heading = Math.atan2(dx, dz)
        p.swing += dt * p.speed * 5.6
      }
    } else if (p.kind === 'worker') {
      p.x = p.ax
      p.z = p.az
      p.heading = Math.PI
      p.swing = 0
    } else {
      const a = elapsed * (p.speed * 0.45) + p.phase
      p.x = p.ax + Math.cos(a) * p.orbit
      p.z = p.az + Math.sin(a) * p.orbit
      p.heading = a + Math.PI / 2
      p.swing += dt * 10.5
    }
  }

  // ------------------------------------------------- separation + yield
  // keep people out of each other and let them step aside for you
  for (let i = 0; i < peds.length; i++) {
    const a = peds[i]
    for (let j = i + 1; j < peds.length; j++) {
      const b = peds[j]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const d2 = dx * dx + dz * dz
      if (d2 > 0.56 || d2 < 1e-6) continue
      const d = Math.sqrt(d2)
      const push = (0.75 - d) * 0.5
      const ux = dx / d
      const uz = dz / d
      const aStatic = a.kind === 'vendor' || a.kind === 'worker'
      const bStatic = b.kind === 'vendor' || b.kind === 'worker'
      if (!aStatic) slideMove(a, -ux * push, -uz * push)
      if (!bStatic) slideMove(b, ux * push, uz * push)
    }
    // yield to the player: nobody phases through you, they step aside
    const pdx = a.x - px
    const pdz = a.z - pz
    const pd2 = pdx * pdx + pdz * pdz
    if (pd2 < 1.44 && pd2 > 1e-6) {
      const pd = Math.sqrt(pd2)
      const push = (1.2 - pd) * 0.85
      slideMove(a, (pdx / pd) * push, (pdz / pd) * push)
      if (a.kind !== 'vendor' && a.kind !== 'worker') a.heading = Math.atan2(pdx, pdz)
    }
  }

  // ------------------------------------------------- draw
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i]
    const walking =
      p.kind === 'walker' || p.kind === 'hawker' || p.kind === 'kid' || (p.kind === 'shopper' && Math.hypot(p.tx - p.x, p.tz - p.z) > 0.8)
    const sw = walking ? Math.sin(p.swing) : 0
    const s = p.height

    rootM.compose(posV.set(p.x, 0, p.z), q.setFromEuler(eul.set(0, p.heading, 0)), scaleV.set(s, s, s))
    torsoM.setMatrixAt(i, rootM)
    headM.setMatrixAt(i, rootM)
    setPart(legM, i * 2, rootM, -0.16, 0.85, 0, sw * 0.6)
    setPart(legM, i * 2 + 1, rootM, 0.16, 0.85, 0, -sw * 0.6)
    const armBase = p.kind === 'worker' ? -0.9 + Math.sin(elapsed * 6 + p.phase) * 0.55 : 0
    setPart(armM, i * 2, rootM, -0.33, 1.42, 0, p.kind === 'worker' ? armBase : -sw * 0.45)
    setPart(armM, i * 2 + 1, rootM, 0.33, 1.42, 0, p.kind === 'worker' ? armBase : sw * 0.45)
    // face follows the head; hide per kind
    eyesM.setMatrixAt(i, rootM)
    pupilsM.setMatrixAt(i, rootM)
    browM.setMatrixAt(i, rootM)
    noseM.setMatrixAt(i, rootM)
    mouthM.setMatrixAt(i, rootM)
    if (p.female) {
      hairM.setMatrixAt(i, partM.makeScale(0, 0, 0))
      hijabM.setMatrixAt(i, rootM)
      skirtM.setMatrixAt(i, rootM)
      setPart(legM, i * 2, rootM, -0.16, 0.85, 0, sw * 0.3)
      setPart(legM, i * 2 + 1, rootM, 0.16, 0.85, 0, -sw * 0.3)
    } else {
      hairM.setMatrixAt(i, rootM)
      hijabM.setMatrixAt(i, partM.makeScale(0, 0, 0))
      skirtM.setMatrixAt(i, partM.makeScale(0, 0, 0))
    }
    if (p.kind === 'hawker') {
      trayM.setMatrixAt(i, rootM)
    } else {
      trayM.setMatrixAt(i, partM.makeScale(0, 0, 0))
    }
  }
  for (const m of [torsoM, headM, legM, armM, trayM, eyesM, pupilsM, browM, noseM, mouthM, hairM, hijabM, skirtM]) {
    m.instanceMatrix.needsUpdate = true
  }

  // ------------------------------------------------- registry + prompt
  pedRegistryReset()
  for (const p of peds) {
    pedRegistryPush({
      id: p.id,
      x: p.x,
      z: p.z,
      heading: p.heading,
      kind: p.kind,
      name: pedName(p.female, p.id * 7 + 3),
      female: p.female,
      talking: p.talking,
      kid: p.kid
    })
  }
  promptTimer -= dt
  if (promptTimer <= 0) {
    promptTimer = 0.2
    let best: { id: number; name: string; kind: PedKind } | null = null
    let bestD = 2.7
    for (const p of peds) {
      if (p.talking > 0) continue
      const d = Math.hypot(p.x - px, p.z - pz)
      if (d < bestD) {
        bestD = d
        best = { id: p.id, name: pedName(p.female, p.id * 7 + 3), kind: p.kind }
      }
    }
    pedPrompt.value = best
  }

  // the football
  ball.position.set(
    PITCH[0] + Math.sin(elapsed * 0.8) * 9,
    0.34 + Math.abs(Math.sin(elapsed * 3.1)) * 0.9,
    PITCH[1] + Math.sin(elapsed * 1.25) * 6
  )
  ball.rotation.set(elapsed * 2, elapsed * 1.3, 0)
})

// conversation: pause the ped and put a local line in the dialogue box
onMounted(() => {
  window.addEventListener('kk-ped-talk', onTalk)
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-ped-talk', onTalk)
})
function onTalk() {
  const prompt = pedPrompt.value
  if (!prompt) return
  const p = peds.find((e) => e.id === prompt.id)
  if (!p) return
  p.talking = 7
  p.heading = Math.atan2(playerPos.value[0] - p.x, playerPos.value[2] - p.z)
  ui.dialogue = {
    npcName: pedName(p.female, p.id * 7 + 3),
    text: pedLine(p.kind, pedClock.hour),
    engine: 'street_chat'
  }
}
void lastElapsed

// headless verification probe
if (import.meta.dev) {
  ;(window as any).__kk_crowd = () => ({
    total: peds.length,
    walkers: peds.filter((p) => p.kind === 'walker' || p.kind === 'hawker').length,
    crossing: peds.filter((p) => p.stage === 'cross').length,
    waiting: peds.filter((p) => p.stage === 'wait').length,
    toCross: peds.filter((p) => p.stage === 'toCross').length,
    talking: peds.filter((p) => p.talking > 0).length,
    firstPos: peds.length ? [+peds[0].x.toFixed(1), +peds[0].z.toFixed(1)] : null,
    probeCars: trafficProbe.cars.length,
    crosswalks: CROSSWALKS.map((c) => [+c.x.toFixed(0), +c.z.toFixed(0)]),
    walkerStages: peds
      .filter((p) => p.kind === 'walker')
      .slice(0, 6)
      .map((p) => [p.stage, Math.round(p.crossTimer)])
  })
  ;(window as any).__kk_nearest_ped = () => {
    const px = playerPos.value[0]
    const pz = playerPos.value[2]
    let best: Ped | null = null
    let bestD = Infinity
    for (const p of peds) {
      const d = Math.hypot(p.x - px, p.z - pz)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best ? [+best.x.toFixed(2), +best.z.toFixed(2), best.kind, +bestD.toFixed(1)] : null
  }
}
</script>

<template>
  <TresGroup ref="groupRef" />
</template>
