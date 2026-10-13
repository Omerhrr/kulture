<script setup lang="ts">
import { useWorkStore } from '~/stores/work'
const workStore = useWorkStore()
// TrafficSystem v2 - ambient traffic that behaves like real street traffic:
//   - vehicles keep their lane, follow the car ahead and never overlap
//   - they stop at the new traffic signals (market front, the square, the
//     keke stop road) and queue at the market congestion zone
//   - they honk when stuck (quietly, and only when you are nearby)
//   - headlight glows come on with the night from the DayNight clock
// The train and the airport circuit plane stay here as ambience. Live
// vehicle positions are published through trafficProbe so pedestrians wait
// for gaps and dodge.
import * as THREE from 'three'
import { BAKE, roadW } from '~/utils/kaduna'
import { vehicleMaterial, vehicleSpec, type VehicleKind } from '~/utils/vehicles'
import { signals, signalPhase, marketFront, type Signal } from '~/utils/kadunaLighting'
import { probeReset, probePush, trafficProbe } from '~/utils/trafficProbe'
import { hitsBuilding } from '~/utils/collision'
import { kkAudio } from '~/utils/audio'
import { knockPlayer, registerCrash, throwMelee, hitNamed } from '~/utils/impact'
import { useRide, useInterior } from '~/composables/useControlsState'
import { useIsTouch } from '~/composables/useControlsState'

const isTouch = useIsTouch()
const nightFactor = useState<number>('kk_night', () => 0)
const playerPosState = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const rideRef = useRide()
const interiorRef = useInterior()

// ---------------------------------------------------------------- routes
interface Route {
  pts: Float32Array
  cum: Float32Array
  total: number
  rw: number
}
function makeRoutes(classes: string[]): Route[] {
  const out: Route[] = []
  for (const r of BAKE.roads) {
    if (!classes.includes(r.class) || r.pts.length < 2) continue
    const flat = new Float32Array(r.pts.length * 2)
    const cum = new Float32Array(r.pts.length)
    let total = 0
    for (let i = 0; i < r.pts.length; i++) {
      flat[i * 2] = r.pts[i][0]
      flat[i * 2 + 1] = r.pts[i][1]
      if (i > 0) total += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1])
      cum[i] = total
    }
    out.push({ pts: flat, cum, total, rw: roadW(r) })
  }
  return out
}
const mainRoutes = makeRoutes(['trunk', 'primary'])
const allRoutes = makeRoutes(['trunk', 'primary', 'residential', 'secondary', 'unclassified'])

// ---------------------------------------------------------------- road network
// Junctions: where a road ends (or is cut by a building), vehicles turn
// onto a road that passes close by instead of U-turning in place, so
// traffic flows across the whole connected network.
interface Exit {
  route: Route
  s: number
  dirs: number[]
}
const JUNCTION_R = 11
const junctionCache = new Map<Route, Map<number, Exit[]>>()
function routeIndexFor(routes: Route[]) {
  const CELL = 24
  const grid = new Map<string, Array<[Route, number, number, number]>>() // route, s, x, z
  for (const rt of routes) {
    for (let s = 0; s <= rt.total; s += 8) {
      routePoint(rt, s, tmpJ)
      const k = `${Math.floor(tmpJ.x / CELL)},${Math.floor(tmpJ.z / CELL)}`
      let a = grid.get(k)
      if (!a) grid.set(k, (a = []))
      a.push([rt, s, tmpJ.x, tmpJ.z])
    }
    routePoint(rt, rt.total, tmpJ)
    const k = `${Math.floor(tmpJ.x / CELL)},${Math.floor(tmpJ.z / CELL)}`
    let a = grid.get(k)
    if (!a) grid.set(k, (a = []))
    a.push([rt, rt.total, tmpJ.x, tmpJ.z])
  }
  return (rt: Route, x: number, z: number): Exit[] => {
    const best = new Map<Route, { s: number; d: number }>()
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const [r2, s2, x2, z2] of grid.get(`${cx + i},${cz + j}`) ?? []) {
          if (r2 === rt) continue
          const d = Math.hypot(x2 - x, z2 - z)
          if (d > JUNCTION_R) continue
          const b = best.get(r2)
          if (!b || d < b.d) best.set(r2, { s: s2, d })
        }
    const out: Exit[] = []
    for (const [r2, { s: s2 }] of best) {
      const dirs: number[] = []
      if (s2 < r2.total - 12) dirs.push(1)
      if (s2 > 12) dirs.push(-1)
      if (dirs.length) out.push({ route: r2, s: s2, dirs })
    }
    return out
  }
}
const tmpJ = { x: 0, z: 0, fx: 0, fz: 1 }
const finders = new Map<Route[], ReturnType<typeof routeIndexFor>>()
function exitsAt(routes: Route[], rt: Route, s: number): Exit[] {
  let f = finders.get(routes)
  if (!f) finders.set(routes, (f = routeIndexFor(routes)))
  const key = Math.round(s / 6)
  let m = junctionCache.get(rt)
  if (!m) junctionCache.set(rt, (m = new Map()))
  let hit = m.get(key)
  if (!hit) {
    routePoint(rt, s, tmpJ)
    hit = f(rt, tmpJ.x, tmpJ.z)
    m.set(key, hit)
  }
  return hit
}
// stretches of a road that run into a building (procedural city overlap):
// sampled lazily once the collision grid exists
const blockedCache = new Map<Route, Uint8Array>()
function blockedAt(rt: Route, s: number): boolean {
  let b = blockedCache.get(rt)
  if (!b) {
    b = new Uint8Array(Math.ceil(rt.total / 4) + 1)
    for (let i = 0; i < b.length; i++) {
      routePoint(rt, Math.min(rt.total, i * 4), tmpJ)
      b[i] = hitsBuilding(tmpJ.x, tmpJ.z, 0.6) ? 1 : 0
    }
    blockedCache.set(rt, b)
  }
  return b[Math.max(0, Math.min(b.length - 1, Math.round(s / 4)))] === 1
}
/** at a dead end: take a connected road (not straight back) if there is one */
function turnAtJunction(car: Car, routes: Route[]) {
  const exits = exitsAt(routes, car.route, car.s).filter((e) => !blockedAt(e.route, e.s))
  if (exits.length) {
    const e = exits[Math.floor(Math.random() * exits.length)]
    car.route = e.route
    car.s = e.s
    car.dir = e.dirs[Math.floor(Math.random() * e.dirs.length)] as 1 | -1
    car.v *= 0.55 // slow for the turn
    return
  }
  car.dir = (car.dir === 1 ? -1 : 1) as 1 | -1
}

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
  out.x = ax + (bx - ax) * t
  out.z = az + (bz - az) * t
  // duplicate route points make a zero-length segment: keep the previous
  // heading rather than a (0, 0) one (which broke facing + hit tests)
  const n = rt.pts.length / 2
  for (let i = lo; i < n - 1; i++) {
    const ex = rt.pts[(i + 1) * 2] - rt.pts[i * 2]
    const ez = rt.pts[(i + 1) * 2 + 1] - rt.pts[i * 2 + 1]
    const len = Math.hypot(ex, ez)
    if (len > 1e-6) {
      out.fx = ex / len
      out.fz = ez / len
      return
    }
  }
}

// ---------------------------------------------------------------- fleet
interface Car {
  route: Route
  s: number
  dir: 1 | -1
  base: number
  v: number
  x: number
  z: number
  fx: number
  fz: number
  h: number
  stuck: number
  /** seconds spent overlapping a solid footprint (respawn when it persists) */
  overlapT: number
  /** cooldown after hitting something */
  hitCd: number
  /** false once the night factor passes offAt: the vehicle is parked out of sight */
  active: boolean
  /** night factor at which this vehicle goes off duty (2 = runs all night) */
  offAt: number
}
// when the city goes to sleep each class keeps its own hours: bicycles
// disappear first, then buses, kekes and okadas thin out; a third of the
// cars and half the trucks keep moving all night
function serviceEnd(kind: VehicleKind): number {
  const h = Math.random()
  switch (kind) {
    case 'bicycle': return 0.42 + h * 0.26
    case 'bus': return 0.55 + h * 0.3
    case 'keke': return 0.58 + h * 0.32
    case 'okada': return 0.6 + h * 0.3
    case 'car': return h < 0.3 ? 2 : 0.72 + h * 0.33
    case 'truck': return h < 0.5 ? 2 : 0.82 + h * 0.23
    default: return 1.2
  }
}
function spawnCar(routes: Route[], min: number, max: number, kind: VehicleKind): Car {
  const route = routes[Math.floor(Math.random() * routes.length)] ?? routes[0]
  return {
    route,
    s: Math.random() * route.total,
    dir: Math.random() < 0.5 ? 1 : -1,
    base: min + Math.random() * (max - min),
    v: min + Math.random() * (max - min),
    x: 0,
    z: 0,
    fx: 0,
    fz: 1,
    h: 0,
    stuck: 0,
    overlapT: 0,
    hitCd: 0,
    active: true,
    offAt: serviceEnd(kind)
  }
}

interface ClassDef {
  kind: VehicleKind
  count: number
  routes: Route[]
  min: number
  max: number
  tint?: string[]
}
const CLASSES: ClassDef[] = [
  { kind: 'car', count: isTouch.value ? 8 : 14, routes: mainRoutes, min: 16, max: 26, tint: ['#dfe3ea', '#2b3440', '#3f6fae', '#3f7d5b', '#b8bcc4', '#7a4a8a'] },
  { kind: 'car', count: isTouch.value ? 3 : 5, routes: mainRoutes, min: 15, max: 24, tint: ['#e8c84a'] },
  { kind: 'keke', count: isTouch.value ? 5 : 9, routes: allRoutes, min: 10, max: 15 },
  { kind: 'okada', count: isTouch.value ? 4 : 7, routes: allRoutes, min: 13, max: 20 },
  { kind: 'bus', count: isTouch.value ? 3 : 6, routes: mainRoutes, min: 12, max: 18 },
  { kind: 'truck', count: isTouch.value ? 2 : 4, routes: mainRoutes, min: 10, max: 15 },
  { kind: 'bicycle', count: isTouch.value ? 2 : 4, routes: allRoutes, min: 6, max: 9 }
].filter((c) => c.routes.length > 0)

const carsByClass: Car[][] = CLASSES.map((c) => Array.from({ length: c.count }, () => spawnCar(c.routes, c.min, c.max, c.kind)))
const allCars: Car[] = carsByClass.flat()

const SIGNALS = signals()
const MARKET = marketFront()

// ---------------------------------------------------------------- meshes
const groupRef = ref<THREE.Group | null>(null)
const meshes: THREE.InstancedMesh[] = []
let headlightM: THREE.InstancedMesh | null = null
interface LampSet {
  red: THREE.MeshBasicMaterial
  amber: THREE.MeshBasicMaterial
  green: THREE.MeshBasicMaterial
}
const lampMats: LampSet[] = []

onMounted(() => {
  const g = groupRef.value
  if (!g) return
  const mat = vehicleMaterial()
  let total = 0
  for (const c of CLASSES) total += c.count
  CLASSES.forEach((c, ci) => {
    const spec = vehicleSpec(c.kind)
    const m = new THREE.InstancedMesh(spec.geoRider, mat, c.count)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.castShadow = true
    const col = new THREE.Color()
    for (let i = 0; i < c.count; i++) {
      col.set(c.tint ? c.tint[i % c.tint.length] : '#ffffff')
      m.setColorAt(i, col)
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    g.add(m)
    meshes.push(m)
  })

  // one instanced quad pair per vehicle for headlight glow at night
  const hlGeo = buildCrossQuads(0.42, 0.28)
  headlightM = new THREE.InstancedMesh(hlGeo, new THREE.MeshBasicMaterial({ color: '#ffedb8', transparent: true, opacity: 0, depthWrite: false }), total)
  headlightM.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  headlightM.renderOrder = 3
  g.add(headlightM)

  buildSignalPoles(g)
  g.add(buildTrain())
  g.add(buildPlane())
})

function buildCrossQuads(w: number, h: number): THREE.BufferGeometry {
  const pos: number[] = []
  // two crossed vertical quads centered on origin
  const q1 = [
    [-w, -h, 0], [w, -h, 0], [w, h, 0],
    [-w, -h, 0], [w, h, 0], [-w, h, 0]
  ]
  const q2 = [
    [0, -h, -w], [0, -h, w], [0, h, w],
    [0, -h, -w], [0, h, w], [0, h, -w]
  ]
  for (const q of [q1, q2]) for (const [x, y, z] of q) pos.push(x, y, z)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

const DARK = 0x2a2320
const LIT: Record<string, string> = { red: '#ff4a3a', amber: '#ffb03a', green: '#4ae05a' }

function buildSignalPoles(g: THREE.Group) {
  for (const sig of SIGNALS) {
    const poleMat = new THREE.MeshLambertMaterial({ color: '#3a3f46' })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6), poleMat)
    pole.position.set(sig.px, 2.3, sig.pz)
    pole.castShadow = true
    g.add(pole)
    // arm reaching over the road toward the lane the signal controls
    const dirSide = (sig.px - sig.x) * -sig.fz + (sig.pz - sig.z) * sig.fx > 0 ? 1 : -1
    const armLen = sig.rw / 2 + 1.0
    const ax = -sig.fz * armLen * dirSide
    const az = sig.fx * armLen * dirSide
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, armLen), poleMat)
    // orient the box along the arm direction
    arm.position.set(sig.px + ax / 2, 4.4, sig.pz + az / 2)
    arm.rotation.y = Math.atan2(ax, az) // box length runs along local z
    g.add(arm)
    // housing + three lamps at the arm tip, facing back along the road
    const hx = sig.px + ax
    const hz = sig.pz + az
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.0, 0.3), new THREE.MeshLambertMaterial({ color: '#22262c' }))
    housing.position.set(hx, 4.0, hz)
    g.add(housing)
    const mk = (y: number) => {
      const m = new THREE.MeshBasicMaterial({ color: DARK })
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), m)
      lamp.position.set(hx, y, hz)
      g.add(lamp)
      return m
    }
    lampMats.push({ red: mk(4.32), amber: mk(4.0), green: mk(3.68) })
  }
}

onBeforeUnmount(() => {
  for (const m of meshes) m.dispose()
  headlightM?.dispose()
})

// ---------------------------------------------------------------- train
let trainMesh: THREE.Mesh | null = null
let trainRoute: Route | null = null
let trainS = 0
let trainX = 0
let trainZ = 0
const puffs: Array<{ sprite: THREE.Sprite; mat: THREE.SpriteMaterial }> = []

function buildTrain(): THREE.Group {
  const group = new THREE.Group()
  let best: [number, number][] | null = null
  let bestLen = 0
  for (const line of BAKE.rail) {
    let len = 0
    for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
    if (len > bestLen) {
      bestLen = len
      best = line
    }
  }
  if (best) {
    const flat = new Float32Array(best.length * 2)
    const cum = new Float32Array(best.length)
    let total = 0
    for (let i = 0; i < best.length; i++) {
      flat[i * 2] = best[i][0]
      flat[i * 2 + 1] = best[i][1]
      if (i > 0) total += Math.hypot(best[i][0] - best[i - 1][0], best[i][1] - best[i - 1][1])
      cum[i] = total
    }
    trainRoute = { pts: flat, cum, total, rw: 1.7 }
    const parts: Array<[string, THREE.BufferGeometry]> = []
    const boxAt = (hex: string, w: number, h: number, d: number, z: number) => {
      const gg = new THREE.BoxGeometry(w, h, d)
      gg.translate(0, h / 2 + 0.55, z)
      parts.push([hex, gg])
    }
    boxAt('#3f6f3a', 2.4, 2.6, 8.5, 0)
    boxAt('#d8c23c', 2.3, 2.4, 8.0, -10)
    boxAt('#d8c23c', 2.3, 2.4, 8.0, -19)
    boxAt('#d8c23c', 2.3, 2.4, 8.0, -28)
    boxAt('#22262c', 2.0, 0.7, 38, -14)
    const geo = new THREE.BufferGeometry()
    const geos = parts.map(([hex, gg]) => {
      const g2 = gg.toNonIndexed()
      gg.dispose()
      g2.deleteAttribute('uv')
      const c = new THREE.Color(hex)
      const n = g2.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      g2.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      return g2
    })
    let tot = 0
    for (const g2 of geos) tot += g2.attributes.position.count
    const pos = new Float32Array(tot * 3)
    const ver = new Float32Array(tot * 3)
    let off = 0
    for (const g2 of geos) {
      pos.set(g2.attributes.position.array as Float32Array, off)
      ver.set(g2.attributes.color.array as Float32Array, off)
      off += g2.attributes.position.count * 3
      g2.dispose()
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(ver, 3))
    geo.computeVertexNormals()
    trainMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
    trainMesh.castShadow = true
    group.add(trainMesh)

    const cv = document.createElement('canvas')
    cv.width = cv.height = 64
    const ctx = cv.getContext('2d')!
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30)
    grad.addColorStop(0, 'rgba(240,240,238,0.85)')
    grad.addColorStop(1, 'rgba(240,240,238,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, depthWrite: false })
      const sp = new THREE.Sprite(mat)
      sp.scale.setScalar(3)
      group.add(sp)
      puffs.push({ sprite: sp, mat })
    }
  }
  return group
}

// ---------------------------------------------------------------- plane
const ap = BAKE.airport
const plane = new THREE.Group()
let planePhase: 'idle' | 'roll' | 'circle' | 'approach' | 'rollout' = 'idle'
let planeSpeed = 0
let planeAlt = 0
let planeHeading = 0
let planeX = 0
let planeZ = 0
let turnAccum = 0
let idleT = 0

function buildPlane(): THREE.Group {
  const spec = vehicleSpec('plane')
  const mesh = new THREE.Mesh(spec.geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.castShadow = true
  plane.add(mesh)
  if (ap.runway && ap.runway.length >= 2) {
    planeX = ap.runway[0][0]
    planeZ = ap.runway[0][1]
    planeHeading = Math.atan2(ap.runway[1][0] - ap.runway[0][0], ap.runway[1][1] - ap.runway[0][1])
  }
  plane.position.set(planeX, 0, planeZ)
  return plane
}

// ---------------------------------------------------------------- update
const tmp = { x: 0, z: 0, fx: 0, fz: 0 }
const tmpA = { x: 0, z: 0, fx: 0, fz: 0 }
const m4 = new THREE.Matrix4()
const posV = new THREE.Vector3()
const q = new THREE.Quaternion()
const oneV = new THREE.Vector3(1, 1, 1)
const eul = new THREE.Euler()
let honkCooldown = 0

// The city is several km across: keep ambient traffic around the player by
// moving far-away vehicles onto a nearby stretch of road (out of sight).
function nearestS(rt: Route, px: number, pz: number): [number, number] {
  let bestD = Infinity
  let bestS = 0
  const n = rt.cum.length
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(rt.pts[i * 2] - px, rt.pts[i * 2 + 1] - pz)
    if (d < bestD) {
      bestD = d
      bestS = rt.cum[i]
    }
  }
  return [bestD, bestS]
}
let recycleTimer = 0
/** put a vehicle back on a road stretch 220-420 m from the player, out of sight */
function respawnNear(car: Car, ci: number) {
  const p = playerPosState.value
  const routes = CLASSES[ci].routes
  for (let t = 0; t < 10; t++) {
    const rt = routes[Math.floor(Math.random() * routes.length)]
    const [d, s] = nearestS(rt, p[0], p[2])
    if (d > 320) continue
    // appear 220-420 m away along the road, never right next to you
    const off = (220 + Math.random() * 200) * (Math.random() < 0.5 ? -1 : 1)
    const ns = Math.max(0.5, Math.min(rt.total - 0.5, s + off))
    if (blockedAt(rt, ns)) continue
    car.route = rt
    car.s = ns
    car.dir = Math.random() < 0.5 ? 1 : -1
    car.v = car.base * 0.8
    break
  }
}
function recycleTraffic() {
  const p = playerPosState.value
  for (let ci = 0; ci < CLASSES.length; ci++) {
    for (const car of carsByClass[ci]) {
      if (!car.active) continue
      if (Math.hypot(car.x - p[0], car.z - p[2]) < 650) continue
      respawnNear(car, ci)
    }
  }
}

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  const dt = Math.min(delta || 0.016, 0.1)
  recycleTimer += dt
  if (recycleTimer > 1.5) {
    recycleTimer = 0
    recycleTraffic()
  }
  probeReset()

  // ---------------- signal lamp colors
  for (let si = 0; si < SIGNALS.length && si < lampMats.length; si++) {
    const ph = signalPhase(SIGNALS[si], elapsed)
    lampMats[si].red.color.set(ph === 'red' ? LIT.red : '#3a2622')
    lampMats[si].amber.color.set(ph === 'amber' ? LIT.amber : '#3a3222')
    lampMats[si].green.color.set(ph === 'green' ? LIT.green : '#1e3324')
  }

  // ---------------- drive every ambient vehicle
  for (let ci = 0; ci < CLASSES.length; ci++) {
    const mesh = meshes[ci]
    if (!mesh) continue
    const cars = carsByClass[ci]
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]
      // duty cycle: past offAt the vehicle parks out of sight (gone home /
      // locked up at the motor park); on wake it rejoins a road near you
      const wasActive = car.active
      car.active = nightFactor.value < car.offAt
      if (!car.active) {
        if (wasActive) {
          car.x = -9000
          car.z = -9000
        }
        m4.compose(posV.set(0, -420, 0), q.identity(), oneV)
        mesh.setMatrixAt(i, m4)
        if (headlightM) headlightM.setMatrixAt(classOffset[ci] + i, m4)
        continue
      }
      if (!wasActive) respawnNear(car, ci)
      // route position + heading; at a road end (or a building across the
      // road) turn onto a connected road instead of driving into it.
      // The test uses the LANE position (drivers ride rw*0.26 off the
      // centerline), not the centerline itself: on narrow roads the lane
      // clips a building edge the centerline clears.
      const ahead = car.s + car.dir * 3.5
      routePoint(car.route, ahead, tmpA)
      const offA = car.route.rw * 0.26 * car.dir
      if (
        blockedAt(car.route, ahead) ||
        hitsBuilding(tmpA.x + -tmpA.fz * offA, tmpA.z + tmpA.fx * offA, 0.8)
      ) {
        turnAtJunction(car, CLASSES[ci].routes)
      }
      if (blockedAt(car.route, car.s)) respawnNear(car, ci) // spawned inside a building
      car.s += car.v * car.dir * dt
      if (car.s >= car.route.total) {
        car.s = car.route.total - 0.1
        turnAtJunction(car, CLASSES[ci].routes)
      } else if (car.s <= 0) {
        car.s = 0.1
        turnAtJunction(car, CLASSES[ci].routes)
      }
      routePoint(car.route, car.s, tmp)
      const off = car.route.rw * 0.26
      car.x = tmp.x + -tmp.fz * off * car.dir
      car.z = tmp.z + tmp.fx * off * car.dir
      car.fx = tmp.fx * car.dir
      car.fz = tmp.fz * car.dir
      car.h = Math.atan2(car.fx, car.fz)
      // solid walls: a car that still ends up overlapping a footprint
      // (tight corner, bad spawn) brakes hard and respawns if it persists
      if (hitsBuilding(car.x, car.z, 0.45)) {
        car.v = Math.max(0, car.v - 26 * dt)
        car.overlapT += dt
        if (car.overlapT > 1.4) {
          respawnNear(car, ci)
          car.overlapT = 0
        }
      } else {
        car.overlapT = 0
      }

      // target speed: base, then constraints
      let target = car.base

      // traffic signals: stop line 3.2 before the head
      for (const sig of SIGNALS) {
        const dx = sig.x - car.x
        const dz = sig.z - car.z
        const along = dx * car.fx + dz * car.fz
        if (along < 0.8 || along > 34) continue
        const side = Math.abs(dx * -car.fz + dz * car.fx)
        if (side > sig.rw / 2 + 1.6) continue
        const ph = signalPhase(sig, elapsed)
        if (ph === 'green') continue
        const stopIn = along - 3.4
        if (ph === 'red') {
          target = Math.min(target, Math.max(0, (stopIn - 0.6) * 0.9))
        } else {
          // amber: stop when there is room, go when already close
          if (stopIn > 5) target = Math.min(target, Math.max(0, (stopIn - 0.6) * 0.9))
        }
      }

      // follow the vehicle ahead (any class, both directions considered)
      for (const other of allCars) {
        if (other === car || !other.active) continue
        const dx = other.x - car.x
        const dz = other.z - car.z
        const d2 = dx * dx + dz * dz
        if (d2 > 121) continue
        const along = dx * car.fx + dz * car.fz
        if (along < 0.3) continue
        const lat = Math.abs(dx * -car.fz + dz * car.fx)
        if (lat > 2.0) continue
        const gap = along - 2.6
        target = Math.min(target, Math.max(0, (gap / 5.5) * other.v))
      }

      // pedestrians: brake for anyone on the road ahead; a car that still
      // runs into someone knocks them over (and the driver slams the
      // brakes - the car answers for the hit)
      for (const pd of trafficProbe.peds) {
        const dx = pd.x - car.x
        const dz = pd.z - car.z
        if (dx * dx + dz * dz > 196) continue
        const along = dx * car.fx + dz * car.fz
        const lat = Math.abs(dx * -car.fz + dz * car.fx)
        if (along > 0.2 && along < 13 && lat < 1.6) target = Math.min(target, Math.max(0, (along - 3.2) * 1.4))
        if (car.v > 3 && Math.abs(along) < 2.2 && lat < 1.0) {
          const power = 2 + car.v * 0.5
          // the crowd ped falls (melee queue) and the named characters react
          throwMelee({ x: car.x, z: car.z, dirX: car.fx, dirZ: car.fz, power, reach: 2.4 })
          hitNamed(car.x, car.z, car.fx, car.fz, power, 2.4)
          if (car.hitCd <= 0) {
            car.v *= 0.35
            car.hitCd = 1.5
          }
        }
      }

      // parked / boardable vehicles are solid: queue behind them instead
      // of ghosting through (the fleet is static, registered by RideSystem)
      for (const pk of trafficProbe.parked) {
        const dx = pk.x - car.x
        const dz = pk.z - car.z
        if (dx * dx + dz * dz > 144) continue
        const along = dx * car.fx + dz * car.fz
        if (along < 0.3) continue
        const lat = Math.abs(dx * -car.fz + dz * car.fx)
        if (lat > pk.r + 1.1) continue
        const gap = along - (1.3 + pk.r)
        target = Math.min(target, Math.max(0, (gap / 5) * car.base))
      }

      // the player's vehicle is an obstacle too
      const pv = trafficProbe.player
      if (pv) {
        const dx = pv.x - car.x
        const dz = pv.z - car.z
        const along = dx * car.fx + dz * car.fz
        const lat = Math.abs(dx * -car.fz + dz * car.fx)
        if (along > 0.3 && along < 10 && lat < 2.2) {
          target = Math.min(target, Math.max(0, ((along - 3) / 5) * trafficProbe.playerSpeed))
        }
      }

      // the player on foot: drivers brake if they see you in time; step out
      // right in front of a moving car and it hits you
      car.hitCd = Math.max(0, car.hitCd - dt)
      if (!rideRef.value.active && !interiorRef.value.inside && !workStore.commute?.active) {
        const pp = playerPosState.value
        const dx = pp[0] - car.x
        const dz = pp[2] - car.z
        const along = dx * car.fx + dz * car.fz
        const lat = Math.abs(dx * -car.fz + dz * car.fx)
        if (along > 0.3 && along < 16 && lat < 1.8) {
          // reaction distance: brake to stop ~3.5 m short of you
          target = Math.min(target, Math.max(0, (along - 3.5) * 1.6))
        }
        const half = CLASSES[ci].kind === 'bus' || CLASSES[ci].kind === 'truck' ? 2.9 : CLASSES[ci].kind === 'car' ? 2.4 : 1.2
        const halfW = CLASSES[ci].kind === 'bus' || CLASSES[ci].kind === 'truck' ? 1.3 : CLASSES[ci].kind === 'car' ? 1.15 : 0.6
        // proximity gate first: a recycled car with a zero heading vector
        // reads along = lat = 0 and would "hit" the player from anywhere
        const near = Math.abs(dx) < half + 1.5 && Math.abs(dz) < half + 1.5
        if (near && car.hitCd <= 0 && along > -half && along < half && lat < halfW + 0.35 && car.v > 1.5) {
          // push mostly along the car's travel, a bit sideways off the bonnet
          const side = (dx * -car.fz + dz * car.fx) >= 0 ? 1 : -1
          const px = car.fx * 0.8 + -car.fz * side * 0.6
          const pz = car.fz * 0.8 + car.fx * side * 0.6
          const n = Math.hypot(px, pz) || 1
          if (import.meta.dev) (window as any).__kk_lasthit = { car: [car.x, car.z], p: [pp[0], pp[2]], along, lat, kind: CLASSES[ci].kind, v: car.v, half, halfW }
          knockPlayer(px / n, pz / n, car.v)
          kkAudio.init()
          kkAudio.impact(Math.min(1, car.v / 14))
          kkAudio.horn(CLASSES[ci].kind)
          car.v *= 0.15
          car.hitCd = 3
        }
      }
      // ...and a crash with the player's own vehicle
      if (pv && car.hitCd <= 0) {
        const dx = pv.x - car.x
        const dz = pv.z - car.z
        const d = Math.hypot(dx, dz)
        if (d < pv.r + 1.4) {
          const rel = Math.abs(trafficProbe.playerSpeed) + car.v
          if (rel > 2) {
            const strength = Math.min(1, rel / 25)
            registerCrash(strength)
            kkAudio.impact(strength)
            window.dispatchEvent(new CustomEvent('kk-crash', { detail: { strength, dx: dx / (d || 1), dz: dz / (d || 1), push: car.v } }))
            car.v = 0
            car.hitCd = 2
          }
        }
      }

      // market congestion: everyone crawls through the market front
      const md = Math.hypot(car.x - MARKET.x, car.z - MARKET.z)
      if (md < MARKET.r) {
        target = Math.min(target, 7)
      }

      // accelerate / brake toward the target
      if (car.v < target) car.v = Math.min(target, car.v + 9 * dt)
      else car.v = Math.max(target, car.v - 14 * dt)
      if (target < 0.2 && car.v < 0.25) car.v = 0

      // honk when stuck (only near the player); stuck too long means a
      // real jam (a parked car across the lane): respawn somewhere free
      if (target < 0.3 && car.base > 8) {
        car.stuck += dt
        honkCooldown -= dt
        if (car.stuck > 2.2 && honkCooldown <= 0 && Math.random() < 0.35) {
          car.stuck = 0
          honkCooldown = 3 + Math.random() * 6
          const px = playerPosState.value
          const d = Math.hypot(car.x - px[0], car.z - px[2])
          if (d < 85) {
            kkAudio.init()
            kkAudio.horn(CLASSES[ci].kind)
          }
        }
        if (car.stuck > 7) {
          respawnNear(car, ci)
          car.stuck = 0
        }
      } else {
        car.stuck = 0
      }

      // draw
      m4.compose(posV.set(car.x, 0, car.z), q.setFromEuler(eul.set(0, car.h, 0)), oneV)
      mesh.setMatrixAt(i, m4)

      // publish to pedestrians + headlight slot
      probePush(car.x, car.z, car.v, car.h, 1.6)
      if (headlightM) {
        const slot = classOffset[ci] + i
        m4.compose(
          posV.set(car.x + car.fx * 1.5, 0.55, car.z + car.fz * 1.5),
          q.setFromEuler(eul.set(0, car.h, 0)),
          oneV
        )
        headlightM.setMatrixAt(slot, m4)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  if (headlightM) {
    headlightM.instanceMatrix.needsUpdate = true
    const mat = headlightM.material as THREE.MeshBasicMaterial
    mat.opacity = Math.max(0, (nightFactor.value - 0.3) / 0.7) * 0.85
    headlightM.visible = mat.opacity > 0.02
  }

  // train
  if (trainMesh && trainRoute) {
    trainS += 9 * dt
    if (trainS >= trainRoute.total - 30) trainS = 0
    routePoint(trainRoute, trainS, tmp)
    trainX = tmp.x
    trainZ = tmp.z
    trainMesh.position.set(tmp.x, 0, tmp.z)
    trainMesh.rotation.y = Math.atan2(tmp.fx, tmp.fz)
    probePush(tmp.x, tmp.z, 9, Math.atan2(tmp.fx, tmp.fz), 3.4)
    for (let i = 0; i < puffs.length; i++) {
      const age = ((performance.now() / 1000) * 0.9 + i / puffs.length) % 1
      const fx = Math.sin(trainMesh.rotation.y)
      const fz = Math.cos(trainMesh.rotation.y)
      puffs[i].sprite.position.set(tmp.x - fx * 2, 3.4 + age * 7, tmp.z - fz * 2)
      puffs[i].mat.opacity = (1 - age) * 0.55
      puffs[i].sprite.scale.setScalar(2 + age * 5)
    }
  }

  // airport circuit
  if (ap.runway) {
    const spec = vehicleSpec('plane')
    if (planePhase === 'idle') {
      idleT += dt
      if (idleT > 7) {
        planePhase = 'roll'
        planeSpeed = 0
        planeAlt = 0
        planeX = ap.runway[0][0]
        planeZ = ap.runway[0][1]
        planeHeading = Math.atan2(ap.runway[1][0] - ap.runway[0][0], ap.runway[1][1] - ap.runway[0][1])
        turnAccum = 0
      }
    } else if (planePhase === 'roll') {
      planeSpeed = Math.min(spec.maxSpeed * 0.72, planeSpeed + 6 * dt)
      planeX += Math.sin(planeHeading) * planeSpeed * dt
      planeZ += Math.cos(planeHeading) * planeSpeed * dt
      if (planeSpeed > 24) planePhase = 'circle'
    } else if (planePhase === 'circle') {
      const rate = 0.16
      planeHeading += rate * dt
      turnAccum += rate * dt
      planeSpeed = Math.min(spec.maxSpeed * 0.72, planeSpeed)
      planeAlt = Math.min(55, planeAlt + 6 * dt)
      planeX += Math.sin(planeHeading) * planeSpeed * dt
      planeZ += Math.cos(planeHeading) * planeSpeed * dt
      if (turnAccum > Math.PI * 2) planePhase = 'approach'
    } else if (planePhase === 'approach') {
      planeSpeed = Math.max(15, planeSpeed - 2.5 * dt)
      planeAlt = Math.max(0, planeAlt - 7 * dt)
      planeX += Math.sin(planeHeading) * planeSpeed * dt
      planeZ += Math.cos(planeHeading) * planeSpeed * dt
      if (planeAlt <= 0) planePhase = 'rollout'
    } else {
      planeSpeed = Math.max(0, planeSpeed - 5.5 * dt)
      planeX += Math.sin(planeHeading) * planeSpeed * dt
      planeZ += Math.cos(planeHeading) * planeSpeed * dt
      if (planeSpeed <= 0.2) {
        planePhase = 'idle'
        idleT = 0
      }
    }
    plane.position.set(planeX, planeAlt, planeZ)
    plane.rotation.y = planeHeading
    plane.rotation.z = planePhase === 'circle' ? -0.16 : 0
    plane.rotation.x = planePhase === 'circle' ? 0.06 : planePhase === 'approach' ? -0.05 : 0
    if (planePhase === 'roll' || planePhase === 'circle') {
      probePush(planeX, planeZ, planeSpeed, planeHeading, 3.2)
    }
  }
})

// first instance index of each class inside the shared headlight buffer
const classOffset: number[] = []
{
  let acc = 0
  for (const c of CLASSES) {
    classOffset.push(acc)
    acc += c.count
  }
}

// headless verification probe
if (import.meta.dev) {
  ;(window as any).__kk_traffic = () => ({
    cars: allCars.length,
    active: allCars.filter((c) => c.active).length,
    stopped: allCars.filter((c) => c.active && c.v < 0.3).length,
    signals: SIGNALS.length,
    avgV: +(
      allCars.filter((c) => c.active).reduce((s, c) => s + c.v, 0) /
      Math.max(1, allCars.filter((c) => c.active).length)
    ).toFixed(1),
    probe: trafficProbe.cars.length,
    posNear: (() => {
      const pp = playerPosState.value
      return allCars
        .filter((c) => c.active && Math.abs(c.x - pp[0]) < 120 && Math.abs(c.z - pp[2]) < 120)
        .map((c) => [Math.round(c.x), Math.round(c.z)])
    })()
  })
}
</script>

<template>
  <TresGroup ref="groupRef" />
</template>
