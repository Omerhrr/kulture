<script setup lang="ts">
// CrowdSystem - the life of the city. Every pedestrian is drawn through six
// InstancedMeshes (torso, head, legs, arms, head tray), so 80+ people cost
// six draw calls total. Behaviors:
//   walker  - strolls the sidewalks of the road network, recycles near you
//   hawker  - walker with a goods tray balanced on the head
//   vendor  - tends a Central Market stall table
//   worker  - swings a hammer at the construction sites
//   kid     - runs circles around the Gamji gate football pitch (with ball)
import * as THREE from 'three'
import { BAKE } from '~/utils/kaduna'
import { SITES, hash01 } from '~/utils/kadunaExtras'
import { useIsTouch } from '~/composables/useControlsState'

const isTouch = useIsTouch()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])

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
// pedestrians prefer real streets, not short stubs
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

// ---------------------------------------------------------------- behaviors
type Kind = 'walker' | 'hawker' | 'vendor' | 'worker' | 'kid' | 'shopper'
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
  // fixed anchors for vendor/worker/kid
  ax: number
  az: number
  orbit: number // kid orbit radius
  swing: number // current gait phase
  // shopper targets
  tx: number
  tz: number
}

const N_WALK = isTouch.value ? 20 : 36
const N_HAWK = isTouch.value ? 6 : 10
const N_VEND = isTouch.value ? 10 : 14
const N_WORK = isTouch.value ? 4 : 6
const N_KID = isTouch.value ? 4 : 6
const N_SHOP = isTouch.value ? 6 : 10
const TOTAL = N_WALK + N_HAWK + N_VEND + N_WORK + N_KID + N_SHOP

const peds: Ped[] = []
const tmp = { x: 0, z: 0, fx: 0, fz: 0 }

function seedWalker(p: Ped, kind: Kind) {
  const rt = walkable[Math.floor(Math.random() * walkable.length)]
  p.kind = kind
  p.route = rt
  p.s = Math.random() * rt.total
  p.dir = Math.random() < 0.5 ? 1 : -1
  p.speed = kind === 'hawker' ? 1.1 + Math.random() * 0.5 : 1.5 + Math.random() * 1.1
}

// market vendor tables mirror the KadunaCity shed grid
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
    swing: Math.random() * 6
  }
  if (i < N_WALK + N_HAWK) {
    seedWalker(p, i < N_WALK ? 'walker' : 'hawker')
  } else if (i < N_WALK + N_HAWK + N_VEND) {
    const k = i - N_WALK - N_HAWK
    const [vx, vz] = vendorSpots[k % vendorSpots.length]
    p.kind = 'vendor'
    p.ax = vx
    p.az = vz
    p.heading = Math.PI + hash01(vx, vz) - 0.5 // face the street
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
    // shoppers drift between stalls inside the market pad
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
  skins: ['#8a5a3b', '#6b4226', '#9c6b45', '#7a4a2c'],
  goods: ['#e8b84b', '#c94a3a', '#3f7d5b', '#b86a2a', '#d86a8a']
}
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

let torsoM: THREE.InstancedMesh | null = null
let headM: THREE.InstancedMesh | null = null
let legM: THREE.InstancedMesh | null = null
let armM: THREE.InstancedMesh | null = null
let trayM: THREE.InstancedMesh | null = null
const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshStandardMaterial({ color: '#e8e4d8', roughness: 0.6 }))

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
    // merge without the utils import: both are simple non-indexed boxes
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

  const mat = (vertexColors = false) => new THREE.MeshLambertMaterial({ vertexColors })
  torsoM = new THREE.InstancedMesh(torsoGeo, mat(), TOTAL)
  headM = new THREE.InstancedMesh(headGeo, mat(), TOTAL)
  legM = new THREE.InstancedMesh(legGeo, mat(), TOTAL * 2)
  armM = new THREE.InstancedMesh(armGeo, mat(), TOTAL * 2)
  trayM = new THREE.InstancedMesh(trayFull, mat(), TOTAL)
  torsoM.castShadow = headM.castShadow = legM.castShadow = true
  for (const m of [torsoM, headM, legM, armM, trayM]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    g.add(m)
  }
  ball.castShadow = true
  g.add(ball)

  const c = new THREE.Color()
  for (let i = 0; i < TOTAL; i++) {
    const shirt = pick(colors.shirts)
    const trouser = pick(colors.trousers)
    const skin = pick(colors.skins)
    c.set(shirt)
    torsoM!.setColorAt(i, c)
    c.set(skin)
    headM!.setColorAt(i, c)
    for (let k = 0; k < 2; k++) {
      legM!.setColorAt(i * 2 + k, c.set(trouser))
      armM!.setColorAt(i * 2 + k, c.set(shirt))
    }
    // tray only for hawkers (hidden by zero scale otherwise)
    c.set(pick(colors.goods))
    trayM!.setColorAt(i, c)
  }
  if (torsoM!.instanceColor) torsoM!.instanceColor.needsUpdate = true
  if (headM!.instanceColor) headM!.instanceColor.needsUpdate = true
  if (legM!.instanceColor) legM!.instanceColor.needsUpdate = true
  if (armM!.instanceColor) armM!.instanceColor.needsUpdate = true
  if (trayM!.instanceColor) trayM!.instanceColor.needsUpdate = true
})

onBeforeUnmount(() => {
  for (const m of [torsoM, headM, legM, armM, trayM]) m?.dispose()
})

// ---------------------------------------------------------------- update
const rootM = new THREE.Matrix4()
const localM = new THREE.Matrix4()
const partM = new THREE.Matrix4()
const posV = new THREE.Vector3()
const oneV = new THREE.Vector3(1, 1, 1)
const zeroV = new THREE.Vector3(0, 0, 0)
const q = new THREE.Quaternion()
const eul = new THREE.Euler()

function setPart(mesh: THREE.InstancedMesh, i: number, root: THREE.Matrix4, px: number, py: number, pz: number, rx = 0) {
  localM.compose(posV.set(px, py, pz), q.setFromEuler(eul.set(rx, 0, 0)), oneV)
  partM.multiplyMatrices(root, localM)
  mesh.setMatrixAt(i, partM)
}

const ZOOM = new THREE.Vector3()
let recycleTimer = 0

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  if (!torsoM || !headM || !legM || !armM || !trayM) return
  const dt = Math.min(delta || 0.016, 0.1)

  // recycle far walkers onto streets near the player
  recycleTimer += dt
  if (recycleTimer > 0.6) {
    recycleTimer = 0
    const px = playerPos.value[0]
    const pz = playerPos.value[2]
    for (const p of peds) {
      if (p.kind !== 'walker' && p.kind !== 'hawker') continue
      if (!p.route) continue
      if (Math.hypot(p.x - px, p.z - pz) < 430) continue
      // pick a nearby street
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
      }
    }
  }

  for (let i = 0; i < peds.length; i++) {
    const p = peds[i]
    if (p.kind === 'walker' || p.kind === 'hawker') {
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
        // walk the edge of the carriageway, on the right-hand side
        const off = p.route.rw / 2 + 0.9
        p.x = tmp.x + -tmp.fz * off * p.dir
        p.z = tmp.z + tmp.fx * off * p.dir
        p.heading = Math.atan2(tmp.fx * p.dir, tmp.fz * p.dir)
      }
      p.swing += dt * p.speed * 5.6
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
        p.x += (dx / dist) * p.speed * dt
        p.z += (dz / dist) * p.speed * dt
        p.heading = Math.atan2(dx, dz)
        p.swing += dt * p.speed * 5.6
      }
    } else if (p.kind === 'worker') {
      p.x = p.ax
      p.z = p.az
      p.heading = Math.PI
      p.swing = 0
    } else {
      // kids run their orbit
      const a = elapsed * (p.speed * 0.45) + p.phase
      p.x = p.ax + Math.cos(a) * p.orbit
      p.z = p.az + Math.sin(a) * p.orbit
      p.heading = a + Math.PI / 2
      p.swing += dt * 10.5
    }

    const walking = p.kind === 'walker' || p.kind === 'hawker' || p.kind === 'kid' || (p.kind === 'shopper' && Math.hypot(p.tx - p.x, p.tz - p.z) > 0.8)
    const sw = walking ? Math.sin(p.swing) : 0

    rootM.compose(
      posV.set(p.x, 0, p.z),
      q.setFromEuler(eul.set(0, p.heading, 0)),
      oneV
    )
    torsoM.setMatrixAt(i, rootM)
    headM.setMatrixAt(i, rootM)
    // legs + arms swing around the hips/shoulders
    setPart(legM, i * 2, rootM, -0.16, 0.85, 0, sw * 0.6)
    setPart(legM, i * 2 + 1, rootM, 0.16, 0.85, 0, -sw * 0.6)
    const armBase = p.kind === 'worker' ? -0.9 + Math.sin(elapsed * 6 + p.phase) * 0.55 : 0
    setPart(armM, i * 2, rootM, -0.33, 1.42, 0, p.kind === 'worker' ? armBase : -sw * 0.45)
    setPart(armM, i * 2 + 1, rootM, 0.33, 1.42, 0, p.kind === 'worker' ? armBase : sw * 0.45)
    // tray rides on hawker heads
    if (p.kind === 'hawker') {
      trayM.setMatrixAt(i, rootM)
    } else {
      trayM.setMatrixAt(i, partM.makeScale(0, 0, 0))
    }
  }
  torsoM.instanceMatrix.needsUpdate = true
  headM.instanceMatrix.needsUpdate = true
  legM.instanceMatrix.needsUpdate = true
  armM.instanceMatrix.needsUpdate = true
  trayM.instanceMatrix.needsUpdate = true

  // the football
  ball.position.set(
    PITCH[0] + Math.sin(elapsed * 0.8) * 9,
    0.34 + Math.abs(Math.sin(elapsed * 3.1)) * 0.9,
    PITCH[1] + Math.sin(elapsed * 1.25) * 6
  )
  ball.rotation.set(elapsed * 2, elapsed * 1.3, 0)
})

// headless verification probe
if (import.meta.dev) {
  ;(window as any).__kk_crowd = () => ({
    total: peds.length,
    walkers: peds.filter((p) => p.kind === 'walker' || p.kind === 'hawker').length,
    vendors: peds.filter((p) => p.kind === 'vendor').length,
    workers: peds.filter((p) => p.kind === 'worker').length,
    kids: peds.filter((p) => p.kind === 'kid').length,
    firstPos: peds.length ? [+peds[0].x.toFixed(1), +peds[0].z.toFixed(1)] : null
  })
}
</script>

<template>
  <TresGroup ref="groupRef" />
</template>
