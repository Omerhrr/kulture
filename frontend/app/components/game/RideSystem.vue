<script setup lang="ts">
// RideSystem - the vehicles you can actually board: two keke NAPEP, cars,
// okadas, danfo buses, a bicycle, a river boat and a light aircraft at the
// airport. Board with E (or the TALK button), drive with W/S + A/D (or the
// joystick), toggle cockpit / chase view with V, exit with E again.
//
// The local player position state follows the vehicle, so the camera rig,
// sun, minimap and the server movement envelope all keep working. Vehicle
// speeds stay under the server envelope (48 u/s), so no reconciliation
// snaps occur while driving.
import * as THREE from 'three'
import { BUILDINGS, clampBounds, unstick } from '~/utils/collision'
import { waterDist } from '~/utils/kadunaExtras'
import { ridePose } from '~/utils/rideState'
import { vehicleSpec, buildInterior, buildDriverFigure, type VehicleKind } from '~/utils/vehicles'
import { BAKE } from '~/utils/kaduna'
import { useKeyboard } from '~/composables/useKeyboard'
import { useRide } from '~/composables/useControlsState'

const ride = useRide()
const { isDown } = useKeyboard()
const { onBeforeRender } = useLoop()

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const playerFacing = useState<number>('kk_player_facing', () => 0)
const socketSend = useState<(type: string, payload: Record<string, unknown>) => boolean>(
  'kk_socket_send',
  () => () => false
)

// ---------------------------------------------------------------- fleet
interface Parked {
  kind: VehicleKind
  x: number
  z: number
  heading: number
  mesh: THREE.Mesh | null
  interior: THREE.Mesh | null
  driver: THREE.Group | null
}

const fleet: Parked[] = []
const root = new THREE.Group()

function boatSpot(): [number, number] {
  // moor at the river bank stretch closest to downtown
  let best: [number, number] = [330, -20]
  let bestD = Infinity
  for (let i = 0; i < BAKE.river.main.length; i += 3) {
    const [x, z] = BAKE.river.main[i]
    const d = Math.hypot(x + 60, z + 10)
    if (d < bestD) {
      bestD = d
      best = [x, z]
    }
  }
  return best
}

onMounted(() => {
  try {
    mountFleet()
    window.addEventListener('kk-ride-toggle', onToggle)
    window.addEventListener('kk-ride-view', toggleView)
  } catch (e) {
    ;(window as any).__kk_ride_err = String((e as Error)?.stack || e)
    throw e
  }
})

function mountFleet() {
  const g = root
  const defs: Array<[VehicleKind, number, number, number]> = [
    ['keke', -249, 428, -0.4],
    ['keke', -236, 427, 2.9],
    ['car', -90, 49, 0.2],
    ['car', -80, 60, 1.35],
    ['okada', -62, 84, 0.4],
    ['okada', -46, 354, 2.6],
    ['bus', 56, -571, 0.9],
    ['bus', -253, 412, 1.8],
    ['bicycle', -95, 44, 0.5]
  ]
  for (const [kind, x, z, heading] of defs) {
    const r = vehicleSpec(kind).radius
    const [fx, fz] = freeSpotNear(x, z, r)
    fleet.push({ kind, x: fx, z: fz, heading, mesh: null, interior: null, driver: null })
  }
  const [bx, bz] = boatSpot()
  fleet.push({ kind: 'boat', x: bx, z: bz, heading: 1.2, mesh: null, interior: null, driver: null })
  const ap = BAKE.airport
  if (ap.apron) {
    fleet.push({ kind: 'plane', x: ap.apron.x + 10, z: ap.apron.z + 9, heading: 0.4, mesh: null, interior: null, driver: null })
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const driverMat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const driverGeo = buildDriverFigure()
  const tint: Partial<Record<VehicleKind, string>> = {
    car: '#3f6fae',
    bicycle: '#3a7d5b'
  }
  for (const p of fleet) {
    const spec = vehicleSpec(p.kind)
    const geo = spec.geo.clone()
    if (p.kind === 'car') {
      // tint the boardable car blue so it reads as "yours"
      const c = new THREE.Color(tint.car!)
      const n = geo.attributes.position.count
      const base = spec.geo.attributes.color.array as Float32Array
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = base[i * 3] * c.r
        arr[i * 3 + 1] = base[i * 3 + 1] * c.g
        arr[i * 3 + 2] = base[i * 3 + 2] * c.b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.position.set(p.x, 0, p.z)
    mesh.rotation.y = p.heading
    p.mesh = mesh
    g.add(mesh)

    const iGeo = buildInterior(p.kind)
    if (iGeo) {
      const im = new THREE.Mesh(iGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }))
      im.position.copy(mesh.position)
      im.rotation.y = p.heading
      im.visible = false
      p.interior = im
      g.add(im)
    }

    // seated driver, shown in chase view
    const driver = new THREE.Group()
    const figure = new THREE.Mesh(driverGeo, driverMat)
    figure.castShadow = true
    driver.add(figure)
    const seat = spec.seat
    driver.userData.seat = seat
    driver.visible = false
    p.driver = driver
    g.add(driver)
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('kk-ride-toggle', onToggle)
  window.removeEventListener('kk-ride-view', toggleView)
})

// ---------------------------------------------------------------- state
let current: Parked | null = null
let speed = 0
let alt = 0 // plane only
let lastSent = 0
let scanTimer = 0
const tmpV = { x: 0, z: 0 }

function collidesAt(x: number, z: number, r: number): boolean {
  for (const b of BUILDINGS) {
    if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true
  }
  return false
}

/** Find a free parking spot near the anchor (houses crowd the city). */
function freeSpotNear(ax: number, az: number, r: number): [number, number] {
  if (!collidesAt(ax, az, r + 1.5)) return [ax, az]
  for (let rad = 2; rad <= 30; rad += 2) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      const x = ax + Math.cos(a) * rad
      const z = az + Math.sin(a) * rad
      if (!collidesAt(x, z, r + 1.5)) return [x, z]
    }
  }
  return [ax, az]
}

function onToggle() {
  if (import.meta.dev) {
    const w = window as any
    w.__kk_toggle_n = (w.__kk_toggle_n || 0) + 1
    w.__kk_toggle_dbg = { active: ride.value.active, prompt: ride.value.prompt, fleet: fleet.length }
  }
  if (ride.value.active) exitVehicle()
  else if (ride.value.prompt) board()
}

function toggleView() {
  if (ride.value.active) ride.value.inner = !ride.value.inner
}

function board() {
  const nearest = nearestParked()
  if (!nearest) return
  current = nearest
  ride.value.active = true
  ride.value.kind = nearest.kind
  ride.value.name = vehicleSpec(nearest.kind).label
  ride.value.inner = false
  ride.value.prompt = null
  const spec = vehicleSpec(nearest.kind)
  ridePose.cabin = spec.cockpit[1]
  ridePose.cockpitFwd = spec.cockpit[0]
  ridePose.active = true
  speed = 0
  if (nearest.kind === 'plane') alt = 0
  // keep camera distance comfortable for vehicles
  orbit.value.dist = Math.max(orbit.value.dist, nearest.kind === 'plane' ? 26 : 14)
}

function exitVehicle() {
  const p = current
  if (!p) return
  // no jumping out of an aircraft in flight
  if (p.kind === 'plane' && alt > 1) {
    ride.value.prompt = 'Land first, then exit'
    return
  }
  // step out on the left side, nudged out of any footprint
  const leftX = p.x + Math.cos(p.heading) * 2.4
  const leftZ = p.z - Math.sin(p.heading) * 2.4
  const [ex, ez] = unstick(...clampBounds(leftX, leftZ))
  playerPos.value = [ex, 0, ez]
  playerFacing.value = p.heading
  socketSend.value('player.move', { position: [ex, 0, ez], facing: p.heading })
  ride.value.active = false
  ride.value.kind = null
  ride.value.name = ''
  ride.value.speed = 0
  ridePose.active = false
  if (p.driver) p.driver.visible = false
  if (p.interior) p.interior.visible = false
  current = null
}

function nearestParked(): Parked | null {
  const px = playerPos.value[0]
  const pz = playerPos.value[2]
  let best: Parked | null = null
  let bestD = Infinity
  for (const p of fleet) {
    const d = Math.hypot(p.x - px, p.z - pz)
    const r = p.kind === 'bicycle' || p.kind === 'okada' ? 2.6 : 3.6
    if (d <= r && d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

const orbit = useCamOrbit()
const touchMove = useTouchMove()

// ---------------------------------------------------------------- physics
onBeforeRender(({ delta }) => {
  const dt = Math.min(delta || 0.016, 0.1)

  // proximity prompt (~6/s, only on foot)
  scanTimer += dt
  if (scanTimer > 0.16) {
    scanTimer = 0
    if (!ride.value.active) {
      const n = nearestParked()
      ride.value.prompt = n ? `Board ${vehicleSpec(n.kind).label}` : null
    }
  }

  if (!ride.value.active || !current) return
  const p = current
  const spec = vehicleSpec(p.kind)

  // throttle + steer from keys and the joystick (same token sets as the
  // walking controls so layout-proof keys behave identically)
  let throttle = 0
  let steer = 0
  if (isDown('KeyW', 'ArrowUp', 'z', 'w')) throttle += 1
  if (isDown('KeyS', 'ArrowDown', 's')) throttle -= 1
  if (isDown('KeyA', 'ArrowLeft', 'q', 'a')) steer -= 1
  if (isDown('KeyD', 'ArrowRight', 'd')) steer += 1
  if (touchMove.value.active) {
    throttle += touchMove.value.y
    steer += touchMove.value.x
  }
  throttle = Math.max(-1, Math.min(1, throttle))
  steer = Math.max(-1, Math.min(1, steer))

  if (p.kind === 'plane') {
    // ---- aircraft: roll, lift off, climb, bank, descend
    if (alt > 0.5) {
      speed += throttle * spec.accel * dt
      // air drag: release the throttle and the plane glides down
      if (Math.abs(throttle) < 0.05) speed = Math.max(8, speed - 1.8 * dt)
      speed = Math.max(8, Math.min(spec.maxSpeed, speed))
      // bank turn, tighter with speed
      p.heading += steer * 0.85 * Math.min(1, speed / 26) * dt
      let climb = (speed - 21) * 0.35
      if (speed < 13) climb -= 8 // stall
      alt = Math.max(0, Math.min(95, alt + climb * dt))
    } else {
      // ground roll
      speed += throttle * spec.accel * dt
      speed = Math.max(0, Math.min(spec.maxSpeed, speed))
      p.heading += steer * 1.1 * Math.min(1, speed / 8) * dt
      let nx = p.x + Math.sin(p.heading) * speed * dt
      let nz = p.z + Math.cos(p.heading) * speed * dt
      ;[nx, nz] = clampBounds(nx, nz)
      if (!collidesAt(nx, nz, spec.radius)) {
        p.x = nx
        p.z = nz
      } else {
        speed *= 0.4
      }
      if (speed > 24) alt = 0.6
    }
    ridePose.y = alt
    ridePose.cabin = spec.cockpit[1]
    // gentle pitch with climb
    if (p.mesh) p.mesh.rotation.x = alt > 0.5 ? Math.max(-0.2, Math.min(0.25, (21 - speed) * 0.012)) : 0
  } else if (p.kind === 'boat') {
    // ---- boat: floats the river, runs aground off the water
    const wet = waterDist(p.x, p.z) < 11
    speed += (wet ? throttle * spec.accel : -4) * dt
    speed = Math.max(0, Math.min(spec.maxSpeed, speed))
    p.heading += steer * 1.3 * Math.min(1, speed / 6) * dt
    const nx = p.x + Math.sin(p.heading) * speed * dt
    const nz = p.z + Math.cos(p.heading) * speed * dt
    if (waterDist(nx, nz) < 11) {
      p.x = nx
      p.z = nz
    } else {
      speed *= 0.5
    }
    ridePose.y = Math.sin(performance.now() / 700) * 0.12
  } else {
    // ---- road vehicles
    speed += throttle * spec.accel * dt
    if (throttle < 0 && speed > 0) speed -= spec.accel * 1.4 * dt // brake
    // engine drag rolls the vehicle to a stop when the throttle is released
    if (Math.abs(throttle) < 0.05 && Math.abs(speed) > 0) {
      const drop = 4.5 * dt
      speed = Math.abs(speed) <= drop ? 0 : speed - Math.sign(speed) * drop
    }
    speed = Math.max(-spec.maxSpeed * 0.4, Math.min(spec.maxSpeed, speed))
    if (Math.abs(speed) < 0.05 && throttle === 0) speed = 0
    const turn = 1.7 * Math.min(1, Math.abs(speed) / 9) * (speed < 0 ? -1 : 1)
    p.heading += steer * turn * dt
    let nx = p.x + Math.sin(p.heading) * speed * dt
    let nz = p.z + Math.cos(p.heading) * speed * dt
    ;[nx, nz] = clampBounds(nx, nz)
    if (!collidesAt(nx, nz, spec.radius)) {
      p.x = nx
      p.z = nz
    } else {
      // try sliding along one axis before bouncing
      const sx = p.x + Math.sin(p.heading) * speed * dt
      const sz = p.z
      const sx2 = p.x
      const sz2 = p.z + Math.cos(p.heading) * speed * dt
      if (!collidesAt(sx, sz, spec.radius)) {
        p.x = sx
        speed *= 0.82
      } else if (!collidesAt(sx2, sz2, spec.radius)) {
        p.z = sz2
        speed *= 0.82
      } else {
        speed *= -0.25
      }
    }
    ridePose.y = 0
  }

  // visual transforms
  if (p.mesh) {
    p.mesh.position.set(p.x, ridePose.y, p.z)
    p.mesh.rotation.y = p.heading
  }
  if (p.interior) {
    p.interior.position.set(p.x, ridePose.y, p.z)
    p.interior.rotation.y = p.heading
    p.interior.visible = ride.value.inner
  }
  if (p.driver) {
    const seat = (p.driver.userData.seat as [number, number, number]) ?? [0, 1, 0]
    p.driver.position.set(
      p.x + Math.sin(p.heading) * seat[2] + Math.cos(p.heading) * seat[0],
      ridePose.y + seat[1] - 0.62,
      p.z + Math.cos(p.heading) * seat[2] - Math.sin(p.heading) * seat[0]
    )
    p.driver.rotation.y = p.heading
    p.driver.visible = !ride.value.inner
  }

  // shared pose: camera + HUD read the cockpit anchor from here
  ridePose.x = p.x
  ridePose.z = p.z
  ridePose.heading = p.heading
  ridePose.speed = speed

  // the world follows the vehicle
  playerPos.value = [p.x, 0, p.z]
  playerFacing.value = p.heading
  ride.value.speed = Math.max(0, Math.round(Math.abs(speed) * 4))

  // throttled server sync (envelope-safe: every vehicle is < 48 u/s)
  const now = performance.now()
  if (now - lastSent > 110) {
    lastSent = now
    socketSend.value('player.move', { position: [p.x, 0, p.z], facing: p.heading })
  }
})

// expose for headless verification
if (import.meta.dev) {
  ;(window as any).__kk_ride = () => ({
    ...ride.value,
    pos: [+playerPos.value[0].toFixed(1), +playerPos.value[2].toFixed(1)]
  })
  ;(window as any).__kk_fleet = () => fleet.map((f) => [f.kind, +f.x.toFixed(0), +f.z.toFixed(0)])
}
</script>

<template>
  <TresGroup>
    <primitive :object="root" />
  </TresGroup>
</template>
