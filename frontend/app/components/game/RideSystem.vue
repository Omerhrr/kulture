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
import { hitsBuilding, clampBounds, unstick, setVehicleObstacles } from '~/utils/collision'
import { waterDist } from '~/utils/kadunaExtras'
import { ridePose } from '~/utils/rideState'
import { trafficProbe } from '~/utils/trafficProbe'
import { kkAudio } from '~/utils/audio'
import { registerCrash } from '~/utils/impact'
import { vehicleSpec, buildInterior, type VehicleKind } from '~/utils/vehicles'
import { BAKE, ws, PLAYABLE_POS } from '~/utils/kaduna'
import { useKeyboard } from '~/composables/useKeyboard'
import { useRide } from '~/composables/useControlsState'

const ride = useRide()
const { isDown } = useKeyboard()
const { onBeforeRender } = useLoop()

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
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
  mesh: THREE.Group | null
  interior: THREE.Mesh | null
  driver: THREE.Group | null
  /** hinged / sliding door pivot (cars, danfo, lorry) */
  door: THREE.Group | null
}

// ---------------------------------------------------------------- boarding
// Getting in and out is animated: walk to the door, the door opens, you
// climb in and sit, the door shuts (and the reverse on the way out).
// Controls only engage once you are seated.
type Phase = 'none' | 'walk' | 'open' | 'climb' | 'close' | 'riding' | 'xopen' | 'xclimb' | 'xclose'
const phase = ref<Phase>('none')
let phaseT = 0
let walkFrom: [number, number] = [0, 0]
let walkDur = 1
const avatarMode = ref<'walk' | 'sit' | 'ride' | 'idle'>('idle')
const avatarRef = ref<THREE.Group | null>(null)
const avatarVisible = ref(false)
const fig = { x: 0, y: 0, z: 0, h: 0 }
const DOOR_T = 0.38
const CLIMB_T = 0.62

/** world point beside the driver's door (local +X side) */
function doorStand(p: Parked): [number, number] {
  const spec = vehicleSpec(p.kind)
  const lat = spec.straddle ? 0.75 : spec.door ? spec.door.hinge[0] + 0.75 : 1.2
  const fwd = spec.seat[2] + (spec.straddle ? 0.1 : 0.3)
  return [p.x + Math.cos(p.heading) * lat + Math.sin(p.heading) * fwd, p.z - Math.sin(p.heading) * lat + Math.cos(p.heading) * fwd]
}
/** seated hip point in world space */
function seatWorld(p: Parked): [number, number, number] {
  const st = vehicleSpec(p.kind).seat
  return [
    p.x + Math.cos(p.heading) * st[0] + Math.sin(p.heading) * st[2],
    ridePose.y + st[1],
    p.z - Math.sin(p.heading) * st[0] + Math.cos(p.heading) * st[2]
  ]
}
function setDoor(p: Parked, open: number) {
  const d = p.door
  const spec = vehicleSpec(p.kind)
  if (!d || !spec.door) return
  if (spec.door.type === 'swing') d.rotation.y = open * 1.15
  else d.position.z = spec.door.hinge[2] - open * 1.1
}

const fleet: Parked[] = []
const root = new THREE.Group()

function boatSpot(): [number, number] {
  // moor at the river bank stretch closest to downtown
  let best: [number, number] = [ws(330), ws(-20)]
  let bestD = Infinity
  for (let i = 0; i < BAKE.river.main.length; i += 3) {
    const [x, z] = BAKE.river.main[i]
    const d = Math.hypot(x - ws(-60), z - ws(-10))
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
    // parked vehicles block the player on foot (no more walking through cars)
    setVehicleObstacles(
      fleet.map((p) => ({
        x: p.x,
        z: p.z,
        w: vehicleSpec(p.kind).radius * 2.4,
        d: vehicleSpec(p.kind).radius * 2.4
      }))
    )
    window.addEventListener('kk-ride-toggle', onToggle)
    window.addEventListener('kk-ride-view', toggleView)
    window.addEventListener('kk-horn', onHorn)
    window.addEventListener('kk-crash', onCrash)
  } catch (e) {
    ;(window as any).__kk_ride_err = String((e as Error)?.stack || e)
    throw e
  }
})

function mountFleet() {
  const g = root
  // parked next to the places you start from (world positions)
  const sp = PLAYABLE_POS.spawn_roadside
  const ks = PLAYABLE_POS.keke_stop
  const st = PLAYABLE_POS.stonetech_square
  const defs: Array<[VehicleKind, number, number, number]> = [
    ['keke', ks[0] + 6, ks[1] + 2, Math.PI / 2],
    ['keke', ks[0] + 11, ks[1] + 2, Math.PI / 2],
    // spawn is on the south sidewalk: park along the kerb just north of it
    ['car', sp[0] + 9, sp[1] - 2.9, Math.PI / 2],
    ['car', sp[0] + 16, sp[1] - 2.9, Math.PI / 2],
    ['keke', sp[0] - 8, sp[1] - 2.7, -Math.PI / 2],
    ['okada', sp[0] + 4, sp[1] + 0.8, 0.4],
    ['okada', st[0] + 14, st[1] - 3, 2.6],
    ['bus', ws(56), ws(-571), 0.9],
    ['bus', ks[0] - 12, ks[1] + 2.5, Math.PI / 2],
    ['bicycle', sp[0] - 3, sp[1] + 0.8, 0.5]
  ]
  for (const [kind, x, z, heading] of defs) {
    const r = vehicleSpec(kind).radius
    const [fx, fz] = freeSpotNear(x, z, r)
    fleet.push({ kind, x: fx, z: fz, heading, mesh: null, interior: null, driver: null, door: null })
  }
  const [bx, bz] = boatSpot()
  fleet.push({ kind: 'boat', x: bx, z: bz, heading: 1.2, mesh: null, interior: null, driver: null, door: null })
  const ap = BAKE.airport
  if (ap.apron) {
    fleet.push({ kind: 'plane', x: ap.apron.x + 10, z: ap.apron.z + 9, heading: 0.4, mesh: null, interior: null, driver: null, door: null })
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
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
    const body = new THREE.Mesh(geo, mat)
    body.castShadow = true
    const mesh = new THREE.Group()
    mesh.add(body)
    if (spec.door) {
      // the door is its own part so it can swing / slide open
      const dg = spec.door.geo.clone()
      if (p.kind === 'car') {
        const c = new THREE.Color(tint.car!)
        const a = dg.attributes.color.array as Float32Array
        for (let i = 0; i < a.length; i += 3) {
          if (a[i] > 0.9 && a[i + 1] > 0.9 && a[i + 2] > 0.9) {
            a[i] *= c.r
            a[i + 1] *= c.g
            a[i + 2] *= c.b
          }
        }
      }
      const pivot = new THREE.Group()
      pivot.position.set(...spec.door.hinge)
      const dm = new THREE.Mesh(dg, mat)
      dm.castShadow = true
      pivot.add(dm)
      mesh.add(pivot)
      p.door = pivot
    }
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

    p.driver = null // the seated person is the shared animated avatar
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('kk-ride-toggle', onToggle)
  window.removeEventListener('kk-ride-view', toggleView)
  window.removeEventListener('kk-horn', onHorn)
  window.removeEventListener('kk-crash', onCrash)
})

function onHorn() {
  kkAudio.init()
  kkAudio.horn(current?.kind ?? 'car')
}

// ---------------------------------------------------------------- state
let current: Parked | null = null
let speed = 0
let alt = 0 // plane only
let lastSent = 0
let scanTimer = 0
// body jolt after a crash (pitch kick that springs back)
let jolt = 0
let steerSmoothed = 0
let joltV = 0
function crashJolt(strength: number) {
  joltV -= strength * 3.2
}
function hitWall(sp: number, max: number) {
  const strength = Math.min(1, Math.abs(sp) / Math.max(8, max * 0.7))
  if (Math.abs(sp) < 2.5) return
  registerCrash(strength)
  kkAudio.impact(strength)
  crashJolt(strength)
}
const tmpV = { x: 0, z: 0 }

function collidesAt(x: number, z: number, r: number): boolean {
  return hitsBuilding(x, z, r)
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

// another vehicle hit us: bounce away from it and kill most of the speed
function onCrash(e: Event) {
  const d = (e as CustomEvent).detail as { strength: number; dx: number; dz: number; push: number }
  const p = current
  if (!p || !ride.value.active) return
  const shove = 0.6 + d.strength * 2.2 + d.push * 0.08
  const nx = p.x + d.dx * shove
  const nz = p.z + d.dz * shove
  if (!collidesAt(nx, nz, vehicleSpec(p.kind).radius)) {
    p.x = nx
    p.z = nz
  }
  speed *= -0.3
  p.heading += (Math.random() - 0.5) * d.strength * 0.6
  crashJolt(d.strength)
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
  if (!nearest || phase.value !== 'none') return
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
  ridePose.x = nearest.x
  ridePose.z = nearest.z
  ridePose.heading = nearest.heading
  ridePose.y = 0
  speed = 0
  if (nearest.kind === 'plane') alt = 0
  // start the walk-to-the-door animation from where the player stands
  walkFrom = [playerPos.value[0], playerPos.value[2]]
  const [sx, sz] = doorStand(nearest)
  walkDur = Math.max(0.35, Math.min(1.6, Math.hypot(sx - walkFrom[0], sz - walkFrom[1]) / 3))
  fig.x = walkFrom[0]
  fig.z = walkFrom[1]
  fig.y = 0
  phase.value = 'walk'
  phaseT = 0
  avatarVisible.value = true
  avatarMode.value = 'walk'
  // keep camera distance comfortable for vehicles
  orbit.value.dist = Math.max(orbit.value.dist, nearest.kind === 'plane' ? 26 : nearest.kind === 'bus' || nearest.kind === 'truck' ? 13 : 9)
}

function exitVehicle() {
  const p = current
  if (!p || phase.value !== 'riding') return
  // no jumping out of an aircraft in flight (or a moving vehicle)
  if (p.kind === 'plane' && alt > 1) {
    ride.value.prompt = 'Land first, then exit'
    return
  }
  if (Math.abs(speed) > 2.5) {
    ride.value.prompt = 'Slow down to get out'
    return
  }
  speed = 0
  kkAudio.setEngine(false, 0, '')
  phase.value = 'xopen'
  phaseT = 0
}

/** Boarding / exiting animation, called every frame while it runs. */
function animatePhase(dt: number) {
  const p = current
  if (!p) return
  const spec = vehicleSpec(p.kind)
  const [sx, sz] = doorStand(p)
  const [seatX, seatY, seatZ] = seatWorld(p)
  const sitMode = spec.straddle || p.kind === 'keke' ? (spec.straddle ? 'ride' : 'sit') : 'sit'
  const hasDoor = !!spec.door
  phaseT += dt
  const ph = phase.value
  if (ph === 'walk') {
    const k = Math.min(1, phaseT / walkDur)
    fig.x = walkFrom[0] + (sx - walkFrom[0]) * k
    fig.z = walkFrom[1] + (sz - walkFrom[1]) * k
    fig.y = 0
    fig.h = Math.atan2(sx - walkFrom[0], sz - walkFrom[1])
    avatarMode.value = k < 1 ? 'walk' : 'idle'
    if (k >= 1) {
      phase.value = hasDoor ? 'open' : 'climb'
      phaseT = 0
      if (hasDoor) kkAudio.impact(0.08)
    }
  } else if (ph === 'open') {
    setDoor(p, Math.min(1, phaseT / DOOR_T))
    fig.h = p.heading - Math.PI / 2 // face the car
    if (phaseT >= DOOR_T) {
      phase.value = 'climb'
      phaseT = 0
    }
  } else if (ph === 'climb') {
    const k = Math.min(1, phaseT / CLIMB_T)
    const e = k * k * (3 - 2 * k)
    fig.x = sx + (seatX - sx) * e
    fig.z = sz + (seatZ - sz) * e
    // step up: hips rise into the seat (sitting puts them at seatY)
    fig.y = (seatY - 0.94) * e + Math.sin(e * Math.PI) * 0.15
    fig.h = p.heading - (Math.PI / 2) * (1 - e)
    avatarMode.value = e > 0.45 ? (sitMode as 'sit' | 'ride') : 'walk'
    if (k >= 1) {
      phase.value = hasDoor ? 'close' : 'riding'
      phaseT = 0
    }
  } else if (ph === 'close') {
    setDoor(p, 1 - Math.min(1, phaseT / DOOR_T))
    if (phaseT >= DOOR_T) {
      kkAudio.impact(0.18)
      phase.value = 'riding'
      phaseT = 0
    }
  } else if (ph === 'xopen') {
    if (!hasDoor) {
      phase.value = 'xclimb'
      phaseT = 0
      return
    }
    setDoor(p, Math.min(1, phaseT / DOOR_T))
    if (phaseT >= DOOR_T) {
      phase.value = 'xclimb'
      phaseT = 0
    }
  } else if (ph === 'xclimb') {
    const k = Math.min(1, phaseT / CLIMB_T)
    const e = k * k * (3 - 2 * k)
    fig.x = seatX + (sx - seatX) * e
    fig.z = seatZ + (sz - seatZ) * e
    fig.y = (seatY - 0.94) * (1 - e) + Math.sin(e * Math.PI) * 0.15
    fig.h = p.heading - (Math.PI / 2) * e
    avatarMode.value = e < 0.55 ? (sitMode as 'sit' | 'ride') : 'walk'
    if (k >= 1) {
      phase.value = hasDoor ? 'xclose' : 'none'
      phaseT = 0
      if (!hasDoor) finishExit()
    }
  } else if (ph === 'xclose') {
    avatarMode.value = 'idle'
    setDoor(p, 1 - Math.min(1, phaseT / DOOR_T))
    if (phaseT >= DOOR_T) {
      kkAudio.impact(0.18)
      phase.value = 'none'
      finishExit()
    }
  }
  // the camera frames the vehicle (or the walking figure while boarding)
  ridePose.x = p.x
  ridePose.z = p.z
  ridePose.heading = p.heading
}

function finishExit() {
  const p = current
  if (!p) return
  const [sx, sz] = doorStand(p)
  const [ex, ez] = unstick(...clampBounds(sx, sz))
  playerPos.value = [ex, 0, ez]
  playerFacing.value = p.heading - Math.PI / 2
  socketSend.value('player.move', { position: [ex, 0, ez], facing: p.heading })
  ride.value.active = false
  ride.value.kind = null
  ride.value.name = ''
  ride.value.speed = 0
  ride.value.inner = false
  ridePose.active = false
  trafficProbe.player = null
  trafficProbe.playerSpeed = 0
  if (p.interior) p.interior.visible = false
  avatarVisible.value = false
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
  if (phase.value !== 'riding') {
    // Boarding/exit phases are pure cosmetic interpolation (no physics, no
    // collision), so they can take big time steps: on a slow machine that
    // clamps to 0.1s per frame the walk-in would otherwise take a minute of
    // wall time. Driving below keeps the tight 0.1s clamp for tunneling.
    animatePhase(Math.min(delta || 0.016, 0.45))
    placeAvatar()
    return
  }
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
  steerSmoothed += (steer - steerSmoothed) * Math.min(1, dt * 6)

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
      if (Math.abs(speed) > 6) hitWall(speed * 0.45, spec.maxSpeed)
      if (!collidesAt(sx, sz, spec.radius)) {
        p.x = sx
        speed *= 0.82
      } else if (!collidesAt(sx2, sz2, spec.radius)) {
        p.z = sz2
        speed *= 0.82
      } else {
        // head-on into a wall: a real crash, the vehicle bounces back
        hitWall(speed, spec.maxSpeed)
        speed *= -0.25
      }
    }
    ridePose.y = 0
  }

  // crash jolt spring (pitch) + lean into turns for two-wheelers
  joltV += (-jolt * 60 - joltV * 9) * dt
  jolt += joltV * dt
  // visual transforms
  if (p.mesh) {
    p.mesh.position.set(p.x, ridePose.y, p.z)
    p.mesh.rotation.y = p.heading
    if (p.kind !== 'plane') {
      p.mesh.rotation.x = jolt * 0.12
      const twoWheel = p.kind === 'okada' || p.kind === 'bicycle'
      p.mesh.rotation.z = twoWheel ? -steerSmoothed * Math.min(1, Math.abs(speed) / 8) * 0.35 : jolt * 0.04
    }
  }
  if (p.interior) {
    p.interior.position.set(p.x, ridePose.y, p.z)
    p.interior.rotation.y = p.heading
    p.interior.visible = ride.value.inner
  }
  // the seated player rides along (hidden in cockpit view)
  {
    const [hx, hy, hz] = seatWorld(p)
    fig.x = hx
    fig.y = hy - 0.94
    fig.z = hz
    fig.h = p.heading
    avatarMode.value = spec.straddle ? 'ride' : 'sit'
    placeAvatar()
    const a = avatarRef.value
    if (a) {
      a.visible = !ride.value.inner
      a.rotation.z = p.mesh ? p.mesh.rotation.z : 0
    }
  }

  // shared pose: camera + HUD read the cockpit anchor from here
  ridePose.x = p.x
  ridePose.z = p.z
  ridePose.heading = p.heading
  ridePose.speed = speed

  // publish to the traffic probe so cars brake for you and peds dodge
  trafficProbe.player = { x: p.x, z: p.z, v: Math.abs(speed), h: p.heading, r: spec.radius }
  trafficProbe.playerSpeed = Math.abs(speed)
  kkAudio.setEngine(true, Math.abs(speed), p.kind)

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

function placeAvatar() {
  const a = avatarRef.value
  if (!a) return
  a.visible = avatarVisible.value
  a.position.set(fig.x, fig.y, fig.z)
  a.rotation.y = fig.h
}

// expose for headless verification
if (import.meta.dev) {
  ;(window as any).__kk_ride = () => ({
    ...ride.value,
    phase: phase.value,
    pos: [+playerPos.value[0].toFixed(1), +playerPos.value[2].toFixed(1)]
  })
  ;(window as any).__kk_fleet = () => fleet.map((f) => [f.kind, +f.x.toFixed(0), +f.z.toFixed(0)])
}
</script>

<template>
  <TresGroup>
    <primitive :object="root" />
    <TresGroup ref="avatarRef" :visible="false">
      <CharacterAvatar
        shirt="#2e7d5b"
        trouser="#2b3440"
        :kufi="true"
        hair-style="cap"
        outfit="kaftan"
        :beard="true"
        :mode="avatarMode"
        :gait-speed="10.5"
      />
    </TresGroup>
  </TresGroup>
</template>
