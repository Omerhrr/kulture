<script setup lang="ts">
// TrafficSystem - ambient traffic on the road network (instanced, one draw
// call per vehicle class), the running train on the rail line, and a plane
// working the airport circuit. Pure ambience: RideSystem owns the vehicles
// you can actually board.
import * as THREE from 'three'
import { BAKE } from '~/utils/kaduna'
import { vehicleSpec, type VehicleKind } from '~/utils/vehicles'
import { useIsTouch } from '~/composables/useControlsState'

const isTouch = useIsTouch()

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
    out.push({ pts: flat, cum, total, rw: r.class === 'trunk' ? 3.2 : r.class === 'primary' ? 2.6 : 1.8 })
  }
  return out
}
const mainRoutes = makeRoutes(['trunk', 'primary'])
const allRoutes = makeRoutes(['trunk', 'primary', 'residential', 'secondary', 'unclassified'])

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
  out.fx = (bx - ax) / segLen
  out.fz = (bz - az) / segLen
}

interface Car {
  route: Route
  s: number
  dir: 1 | -1
  speed: number
}
function spawnCar(routes: Route[], min: number, max: number): Car {
  const route = routes[Math.floor(Math.random() * routes.length)] ?? routes[0]
  return { route, s: Math.random() * route.total, dir: Math.random() < 0.5 ? 1 : -1, speed: min + Math.random() * (max - min) }
}

// ---------------------------------------------------------------- classes
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
  { kind: 'car', count: isTouch.value ? 3 : 5, routes: mainRoutes, min: 15, max: 24, tint: ['#e8c84a'] }, // taxis
  { kind: 'keke', count: isTouch.value ? 5 : 9, routes: allRoutes, min: 10, max: 15 },
  { kind: 'okada', count: isTouch.value ? 4 : 7, routes: allRoutes, min: 13, max: 20 },
  { kind: 'bus', count: isTouch.value ? 3 : 6, routes: mainRoutes, min: 12, max: 18 },
  { kind: 'truck', count: isTouch.value ? 2 : 4, routes: mainRoutes, min: 10, max: 15 },
  { kind: 'bicycle', count: isTouch.value ? 2 : 4, routes: allRoutes, min: 6, max: 9 }
].filter((c) => c.routes.length > 0)

const carsByClass: Car[][] = CLASSES.map((c) =>
  Array.from({ length: c.count }, () => spawnCar(c.routes, c.min, c.max))
)

// ---------------------------------------------------------------- meshes
const groupRef = ref<THREE.Group | null>(null)
const meshes: THREE.InstancedMesh[] = []

onMounted(() => {
  const g = groupRef.value
  if (!g) return
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
  CLASSES.forEach((c, ci) => {
    const spec = vehicleSpec(c.kind)
    const m = new THREE.InstancedMesh(spec.geo, mat, c.count)
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

  g.add(buildTrain())
  g.add(buildPlane())
})

onBeforeUnmount(() => {
  for (const m of meshes) m.dispose()
})

// ---------------------------------------------------------------- train
let trainMesh: THREE.Mesh | null = null
let trainRoute: Route | null = null
let trainS = 0
const puffs: Array<{ sprite: THREE.Sprite; mat: THREE.SpriteMaterial }> = []

function buildTrain(): THREE.Group {
  const group = new THREE.Group()
  // longest rail line
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
    // consist: green loco + 3 yellow coaches
    const parts: Array<[string, THREE.BufferGeometry]> = []
    const boxAt = (hex: string, w: number, h: number, d: number, z: number) => {
      const gg = new THREE.BoxGeometry(w, h, d)
      gg.translate(0, h / 2 + 0.55, z)
      parts.push([hex, gg])
    }
    boxAt('#3f6f3a', 2.4, 2.6, 8.5, 0) // loco
    boxAt('#d8c23c', 2.3, 2.4, 8.0, -10)
    boxAt('#d8c23c', 2.3, 2.4, 8.0, -19)
    boxAt('#d8c23c', 2.3, 2.4, 8.0, -28)
    boxAt('#22262c', 2.0, 0.7, 38, -14)
    const geo = new THREE.BufferGeometry()
    // manual merge
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

    // smoke puffs
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
const m4 = new THREE.Matrix4()
const posV = new THREE.Vector3()
const q = new THREE.Quaternion()
const oneV = new THREE.Vector3(1, 1, 1)
const eul = new THREE.Euler()

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  const dt = Math.min(delta || 0.016, 0.1)

  CLASSES.forEach((c, ci) => {
    const mesh = meshes[ci]
    if (!mesh) return
    const cars = carsByClass[ci]
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]
      car.s += car.speed * car.dir * dt
      if (car.s >= car.route.total) {
        car.s = car.route.total - 0.1
        car.dir = -1
      } else if (car.s <= 0) {
        car.s = 0.1
        car.dir = 1
      }
      routePoint(car.route, car.s, tmp)
      const off = car.route.rw * 0.24 + 0.55
      const x = tmp.x + -tmp.fz * off * car.dir
      const z = tmp.z + tmp.fx * off * car.dir
      const heading = Math.atan2(tmp.fx * car.dir, tmp.fz * car.dir)
      m4.compose(posV.set(x, 0, z), q.setFromEuler(eul.set(0, heading, 0)), oneV)
      mesh.setMatrixAt(i, m4)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  // train
  if (trainMesh && trainRoute) {
    trainS += 9 * dt
    if (trainS >= trainRoute.total - 30) trainS = 0
    routePoint(trainRoute, trainS, tmp)
    trainMesh.position.set(tmp.x, 0, tmp.z)
    trainMesh.rotation.y = Math.atan2(tmp.fx, tmp.fz)
    // smoke
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
      const rate = 0.16 // rad/s, gentle bank
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
  }
})
</script>

<template>
  <TresGroup ref="groupRef" />
</template>
