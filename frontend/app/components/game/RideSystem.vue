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
import { vehicleMaterial, vehicleSpec, buildInterior, paintedVehicle, plateSprite, bodyWithGlass, type VehicleKind } from '~/utils/vehicles'
import { lookFor } from '~/utils/wardrobe'
import { useSimStore } from '~/stores/sim'
import { hashDist, roadHash } from '~/utils/kadunaExtras'
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
  /** someone's own car: 'me' (yours) or the owner's player id */
  owner?: string
  ownerName?: string
  tier?: number
  tag?: THREE.Sprite | null
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
    // ...and ambient traffic brakes for them instead of driving through
    trafficProbe.parked = fleet.map((p) => ({ x: p.x, z: p.z, r: vehicleSpec(p.kind).radius }))
    window.addEventListener('kk-ride-toggle', onToggle)
    window.addEventListener('kk-ride-view', toggleView)
    window.addEventListener('kk-horn', onHorn)
    window.addEventListener('kk-crash', onCrash)
    window.addEventListener('kk-summon-car', onSummon)
    window.addEventListener('kk-car-changed', loadCars)
    window.addEventListener('kk-ride-invite', onInvite)
    window.addEventListener('kk-ride-accept', onAccept)
    window.addEventListener('kk-ws', onRelay)
    setTimeout(loadCars, 3500)
    carTimer = setInterval(loadCars, 20_000)
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

  const mat = vehicleMaterial()
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
      const gloss = spec.geo.attributes.aGloss?.array as Float32Array | undefined
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        // paint only: glass, tyres, chrome and lamps keep their colour
        if (gloss && Math.abs(gloss[i] - 0.7) > 0.01) {
          arr[i * 3] = base[i * 3]
          arr[i * 3 + 1] = base[i * 3 + 1]
          arr[i * 3 + 2] = base[i * 3 + 2]
          continue
        }
        arr[i * 3] = base[i * 3] * c.r
        arr[i * 3 + 1] = base[i * 3 + 1] * c.g
        arr[i * 3 + 2] = base[i * 3 + 2] * c.b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    const mesh = new THREE.Group()
    mesh.add(bodyWithGlass(geo, mat)) // see-through windows: you can see who's inside
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
      pivot.add(bodyWithGlass(dg, mat))
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
  window.removeEventListener('kk-summon-car', onSummon)
  window.removeEventListener('kk-car-changed', loadCars)
  window.removeEventListener('kk-ride-invite', onInvite)
  window.removeEventListener('kk-ride-accept', onAccept)
  window.removeEventListener('kk-ws', onRelay)
  clearInterval(carTimer)
  if (pax) exitPassenger(true)
})

// ---- your own car: paint by tier, and bring it to you (races, Life app)
const carTier = useState<number>('kk_car_tier', () => 0)
// ---------------------------------------------------------------- owned cars
// The car you buy (Phone → Life) is yours alone: your paint, your number
// plate, parked at your home car park (or wherever you left it - the server
// remembers). Other players' cars stand where they left them, locked: you
// can only ride in one if its owner invites you.
const api = useGameApi()
const sim = useSimStore()
const myId = computed(() => usePlayerStore().profile?.id ?? '')
const myName = computed(() => usePlayerStore().profile?.display_name ?? sim.name ?? 'Me')
const homeFront = useState<{ x: number; z: number; nx: number; nz: number; w: number } | null>('kk_home_front', () => null)
let carTimer: ReturnType<typeof setInterval> | undefined
const ownedMat = vehicleMaterial()
let homePad: THREE.Group | null = null

/** your home car park: a paved bay beside the gate, clear of buildings */
function homeParkSpot(): [number, number, number] | null {
  const h = homeFront.value
  if (!h) return null
  // along the street face of the house, a few metres to the side of the gate
  const ax = -h.nz
  const az = h.nx
  for (const side of [1, -1]) {
    for (let off = 4.5; off <= 12; off += 1.5) {
      for (const out of [3.2, 4.5, 2.2]) {
        const x = h.x + ax * off * side + h.nx * out
        const z = h.z + az * off * side + h.nz * out
        if (!collidesAt(x, z, 2.2) && hashDist(roadHash(), x, z, 20) > 3.2) return [x, z, Math.atan2(h.nx, h.nz) + Math.PI]
      }
    }
  }
  const [x, z] = freeSpotNear(h.x + h.nx * 5, h.z + h.nz * 5, 1.8)
  return [x, z, Math.atan2(h.nx, h.nz) + Math.PI]
}
function buildHomePad(x: number, z: number, heading: number) {
  if (homePad) root.remove(homePad)
  const g = new THREE.Group()
  const asphalt = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 6.2), new THREE.MeshStandardMaterial({ color: '#3a3b3f', roughness: 0.95 }))
  asphalt.position.y = 0.03
  asphalt.receiveShadow = true
  g.add(asphalt)
  const line = new THREE.MeshBasicMaterial({ color: '#f2f2ea' })
  for (const sx of [-1.7, 1.7]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 6.0), line)
    l.position.set(sx, 0.07, 0)
    g.add(l)
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.02, 0.1), line)
  back.position.set(0, 0.07, -3)
  g.add(back)
  // little "P" sign on a post
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.1), new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.5 }))
  post.position.set(1.95, 1.05, -2.8)
  g.add(post)
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const cg = c.getContext('2d')!
  cg.fillStyle = '#1f4fa0'
  cg.fillRect(0, 0, 64, 64)
  cg.fillStyle = '#fff'
  cg.font = '800 48px sans-serif'
  cg.textAlign = 'center'
  cg.fillText('P', 32, 50)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }))
  sign.position.set(1.95, 2.0, -2.8)
  g.add(sign)
  g.position.set(x, 0, z)
  g.rotation.y = heading
  homePad = g
  root.add(g)
}

function removeParked(p: Parked) {
  if (p.mesh) root.remove(p.mesh)
  if (p.interior) {
    // the hidden interior mesh owns its geometry + material: drop it too or
    // every rebuild of the fleet leaks one behind (loadCars runs every 20s)
    root.remove(p.interior)
    p.interior.geometry?.dispose()
    ;(p.interior.material as THREE.Material | undefined)?.dispose()
    p.interior = null
  }
  const i = fleet.indexOf(p)
  if (i >= 0) fleet.splice(i, 1)
}
function addOwned(o: { owner: string; ownerName: string; tier: number; color: string; plate: string; x: number; z: number; heading: number }): Parked {
  const { group, door } = paintedVehicle('car', o.color, ownedMat)
  group.position.set(o.x, 0, o.z)
  group.rotation.y = o.heading
  const tag = plateSprite(o.plate, o.owner === 'me' ? '🔑 Your car' : `🔒 ${o.ownerName}`)
  tag.position.set(0, 2.25, 0)
  group.add(tag)
  root.add(group)
  const p: Parked = { kind: 'car', x: o.x, z: o.z, heading: o.heading, mesh: group, interior: null, driver: null, door, owner: o.owner, ownerName: o.ownerName, tier: o.tier, tag }
  const iGeo = buildInterior('car')
  if (iGeo) {
    const im = new THREE.Mesh(iGeo, new THREE.MeshLambertMaterial({ vertexColors: true }))
    im.position.copy(group.position)
    im.rotation.y = o.heading
    im.visible = false
    p.interior = im
    root.add(im)
  }
  fleet.push(p)
  return p
}
let carsKey = ''
async function loadCars() {
  try {
    const [st, list] = await Promise.all([api.apiGet<any>('/life/status'), api.apiGet<any>('/life/cars')])
    carTier.value = st.car_tier
    const mine = st.car
    myCar = mine ?? null
    carColor.value = mine?.color ?? ''
    const others = (list.cars as any[]).filter((c) => c.owner_id !== myId.value && c.parked)
    const key = JSON.stringify([mine && [mine.tier, mine.color, mine.x, mine.z], others.map((c) => [c.owner_id, c.color, c.x, c.z])])
    if (key === carsKey) return
    carsKey = key
    // rebuild every owned car that is not being driven right now
    for (const p of [...fleet]) if (p.owner && p !== current) removeParked(p)
    if (mine && current?.owner !== 'me') {
      const home = homeParkSpot()
      const parked = mine.x != null
      const here = parked && (mine.region ?? 'kaduna-city') === regionSlug()
      // never parked yet: delivered to your home car park in this town.
      // Parked in another town: it stays there (Phone → Life → Bring it here).
      if (here || !parked) {
        const [x, z, h] = here ? [mine.x, mine.z, mine.heading] : home ?? [playerPos.value[0] + 4, playerPos.value[2] + 4, 0]
        addOwned({ owner: 'me', ownerName: myName.value, tier: mine.tier, color: mine.color, plate: mine.plate, x, z, heading: h })
      }
    }
    if (mine) {
      const home = homeParkSpot()
      if (home) buildHomePad(home[0], home[1], home[2])
    }
    for (const c of others) addOwned({ owner: c.owner_id, ownerName: c.owner, tier: c.tier, color: c.color, plate: c.plate, x: c.x, z: c.z, heading: c.heading })
    refreshObstacles()
  } catch {}
}
function regionSlug() {
  try {
    const id = localStorage.getItem('kk_region') || 'kaduna'
    return id === 'kaduna' ? 'kaduna-city' : id.replace('_', '-')
  } catch {
    return 'kaduna-city'
  }
}
function refreshObstacles() {
  trafficProbe.parked = fleet.map((f) => ({ x: f.x, z: f.z, r: vehicleSpec(f.kind).radius }))
  setVehicleObstacles(fleet.filter((f) => f !== current).map((f) => ({ x: f.x, z: f.z, w: vehicleSpec(f.kind).radius * 2.4, d: vehicleSpec(f.kind).radius * 2.4 })))
}
function onSummon(e: Event) {
  const d = (e as CustomEvent).detail as { x: number; z: number; heading: number }
  let p = fleet.find((f) => f.owner === 'me' && f !== current) ?? null
  if (!p && myCar) p = addOwned({ owner: 'me', ownerName: myName.value, tier: myCar.tier, color: myCar.color, plate: myCar.plate, x: d.x, z: d.z, heading: d.heading })
  if (!p) p = fleet.find((f) => f.kind === 'car' && !f.owner && f !== current) ?? null
  if (!p || !p.mesh) return
  // never drop it inside a wall
  const [fx, fz] = freeSpotNear(d.x, d.z, vehicleSpec(p.kind).radius)
  p.x = fx
  p.z = fz
  p.heading = d.heading
  p.mesh.position.set(p.x, 0, p.z)
  p.mesh.rotation.y = p.heading
  if (p.interior) {
    p.interior.position.copy(p.mesh.position)
    p.interior.rotation.y = p.heading
  }
  if (p.owner === 'me') api.apiPost('/life/car/park', { x: p.x, z: p.z, heading: p.heading }).catch(() => {})
  refreshObstacles()
}

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
let ghostTimer = 0
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
  if (pax) exitPassenger(true)
  else if (ride.value.active) exitVehicle()
  else if (ride.value.prompt) board()
}

function toggleView() {
  if (ride.value.active) ride.value.inner = !ride.value.inner
}

function board() {
  const nearest = nearestParked()
  if (!nearest || phase.value !== 'none' || pax) return
  if (nearest.owner && nearest.owner !== 'me') {
    ui.showToast(`That's ${nearest.ownerName}'s car - ask them to invite you along.`, 'info')
    return
  }
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
  // tell everyone what you're driving (they see the vehicle and you in it)
  socketSend.value('ride.state', { kind: nearest.kind, color: nearest.owner === 'me' ? myCarColor() : '' })
  // commercial vehicles come with a few passengers already on board
  spawnNpcRiders(nearest)
  party.value = { role: 'driver', seatsFree: freeSeats(), names: [] }
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
  const sitMode = 'sit' // the mocap body sits on bikes too (no walking legs while riding)
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
    fig.y = ridePose.y + Math.sin(e * Math.PI) * 0.15
    seatH.value = seatY - ridePose.y
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
    fig.y = ridePose.y + Math.sin(e * Math.PI) * 0.15
    seatH.value = seatY - ridePose.y
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
  // your own car stays where you leave it (the server remembers)
  if (p.owner === 'me') api.apiPost('/life/car/park', { x: p.x, z: p.z, heading: p.heading }).catch(() => {})
  // everyone riding with you gets out too
  for (const id of friends.keys()) relay(id, { k: 'ride_end' })
  friends.clear()
  riders.value = []
  party.value = { role: 'none', seatsFree: 0, names: [] }
  socketSend.value('ride.state', { kind: null })
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
  refreshObstacles()
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

// ---------------------------------------------------------------- riders
// Everyone else in the vehicle with you: passengers who were already on the
// danfo / keke, friends you invited, and (when you ride along) the driver.
const ui = useUiStore()
interface RLook { skin: string; top: string; bottom: string; hair: string; hairColor: string; outfit: string; female: boolean; gadgets: string[] }
interface Rider { key: string; seat: number; look: RLook; npc: boolean; id?: string; npcId?: number }
const riders = ref<Rider[]>([])
const riderObjs = new Map<string, THREE.Object3D>()
function setRiderRef(key: string, el: any) {
  const o = el?.isObject3D ? el : el?.instance ?? el?.value
  if (o?.isObject3D) riderObjs.set(key, o)
  else riderObjs.delete(key)
}
function npcLook(id: number): RLook {
  const female = id % 2 === 0
  const l = lookFor(id, female)
  return { skin: l.skin, top: l.top, bottom: l.bottom, hair: female ? 'braids' : 'cap', hairColor: l.hair ?? '#141114', outfit: female ? 'dress' : id % 3 ? 'kaftan' : 'shirt', female, gadgets: (l.gadgets ?? []) as string[] }
}
function playerLook(l: any): RLook {
  l = l ?? {}
  return {
    skin: l.skin || '#7a4e33',
    top: l.top || '#3f6fae',
    bottom: l.bottom || '#2b3440',
    hair: l.hair || 'cap',
    hairColor: l.hairColor || '#141114',
    outfit: l.outfit || 'kaftan',
    female: l.body === 'woman' || l.outfit === 'dress' || !!l.female,
    gadgets: (l.gadgets ?? []).slice(0, 4)
  }
}
const myLook = () => playerLook({ ...sim.look, body: (sim.look as any).body })

// ---------------------------------------------------------------- party
// Invite friends who are near you into your vehicle. The server relays a
// few small messages between the phones; the driver's phone is in charge
// (it hands out seats and streams where the vehicle is).
const party = useState<{ role: 'none' | 'driver' | 'passenger'; seatsFree: number; names: string[] }>('kk_ride_party', () => ({ role: 'none', seatsFree: 0, names: [] }))
const partyIds = useState<string[]>('kk_ride_party_ids', () => [])
const players = useState<{ online: number; players: Array<{ id: string; name: string; pos: [number, number, number]; look: any }> }>('kk_players', () => ({ online: 0, players: [] }))
const friends = new Map<string, { name: string; look: RLook; seat: number }>()
// consent: you only seat people you invited, and only get seated by a
// driver you said yes to (nobody can pull you into their car uninvited)
const invitedAt = new Map<string, number>()
const joinedAt = new Map<string, number>()
/** boarding or driving (not on the way out) */
function inVehicle() {
  return ['walk', 'open', 'climb', 'close', 'riding'].includes(phase.value)
}
function relay(to: string, data: unknown) {
  const ok = (window as any).__kk_ws_send?.('arcade.relay', { to, data })
  if (import.meta.dev) ((window as any).__kk_relays ??= []).push([to.slice(0, 6), (data as any)?.k, ok])
}
const carColor = ref('')
let myCar: { tier: number; color: string; plate: string } | null = null
function myCarColor(): string {
  return carColor.value
}
function freeSeats(): number {
  if (!current) return 0
  return vehicleSpec(current.kind).passengers.length - friends.size
}
function updateParty() {
  party.value = { role: 'driver', seatsFree: freeSeats(), names: [...friends.values()].map((f) => f.name) }
  partyIds.value = [...friends.keys()]
}
function spawnNpcRiders(p: Parked) {
  riders.value = []
  riderMode.value = 'sit'
  riderKind.value = p.kind
  if (p.owner) return
  const seats = vehicleSpec(p.kind).passengers.length
  const n = p.kind === 'bus' ? 2 + Math.floor(Math.random() * 3) : p.kind === 'keke' ? 1 + Math.floor(Math.random() * 2) : p.kind === 'boat' ? 1 : 0
  const seed = Math.floor(Math.random() * 100000)
  const out: Rider[] = []
  for (let i = 0; i < Math.min(n, seats); i++) {
    const seat = seats - 1 - i // NPCs fill from the back; friends from the front
    const npcId = seed + i * 7
    out.push({ key: `npc-${npcId}`, seat, look: npcLook(npcId), npc: true, npcId })
  }
  riders.value = out
}
/** world position of a seat (driver seat when seat < 0) */
function seatPoint(kind: VehicleKind, seat: number, x: number, z: number, h: number, y: number): [number, number, number] {
  const spec = vehicleSpec(kind)
  const o = seat >= 0 ? spec.passengers[seat] ?? spec.seat : spec.seat
  return [x + Math.cos(h) * o[0] + Math.sin(h) * o[2], y + o[1], z - Math.sin(h) * o[0] + Math.cos(h) * o[2]]
}
function placeRiders(kind: VehicleKind, x: number, z: number, h: number, y: number, tilt = 0) {
  for (const r of riders.value) {
    const o = riderObjs.get(r.key)
    if (!o) continue
    const [wx, , wz] = seatPoint(kind, r.seat, x, z, h, y)
    o.position.set(wx, y, wz)
    o.rotation.set(0, h, tilt)
  }
}
const riderMode = ref<'sit' | 'ride'>('sit')
const riderKind = ref<VehicleKind>('car')
const seatH = ref(0.5)
function riderSeat(seat: number): number {
  const spec = vehicleSpec(riderKind.value)
  return (seat >= 0 ? spec.passengers[seat] ?? spec.seat : spec.seat)[1]
}

// driver: invite someone near you
function onInvite(e: Event) {
  const { to, name } = (e as CustomEvent).detail as { to: string; name: string }
  if (!current || !inVehicle()) return ui.showToast('Get in a vehicle first, then invite people along.', 'info')
  if (freeSeats() <= 0) return ui.showToast('No free seats left.', 'info')
  invitedAt.set(to, Date.now())
  relay(to, { k: 'ride_invite', name: myName.value, label: vehicleSpec(current.kind).label, own: current.owner === 'me' })
  ui.showToast(`Invite sent to ${name} 🚗`, 'success')
}
// passenger: you said yes to someone's invite
function onAccept(e: Event) {
  const { from } = (e as CustomEvent).detail as { from: string }
  if (ride.value.active) return ui.showToast('Get out of your vehicle first.', 'info')
  joinedAt.set(from, Date.now())
  relay(from, { k: 'ride_join', name: myName.value, look: myLook() })
}
function onRelay(ev: Event) {
  const d = (ev as CustomEvent).detail
  if (d?.type !== 'arcade.fight') return
  const from = d.payload?.from as string
  const x = d.payload?.data ?? {}
  if (x.k === 'ride_join') driverJoin(from, x)
  else if (x.k === 'ride_leave') driverLeave(from)
  else if (x.k === 'ride_seat' && !ride.value.active && Date.now() - (joinedAt.get(from) ?? 0) < 60_000) {
    joinedAt.delete(from)
    enterPassenger(from, x)
  }
  else if (x.k === 'ride_pose' && pax?.driver === from) passengerPose(x)
  else if (x.k === 'ride_end' && pax?.driver === from) {
    exitPassenger(false)
    ui.showToast('The driver parked - everybody out!', 'info')
  } else if (x.k === 'ride_full') ui.showToast(`No seat for you right now (${x.why ?? 'full'}).`, 'info')
}
function driverJoin(from: string, x: any) {
  const p = current
  if (!p || !inVehicle()) return relay(from, { k: 'ride_full', why: 'the driver got out' })
  if (friends.has(from)) return
  if (Date.now() - (invitedAt.get(from) ?? 0) > 120_000) return // not invited (or the invite ran out)
  invitedAt.delete(from)
  const them = players.value.players.find((pl) => pl.id === from)
  if (them && Math.hypot(them.pos[0] - p.x, them.pos[2] - p.z) > 80) return relay(from, { k: 'ride_full', why: 'walk closer to the vehicle first' })
  const spec = vehicleSpec(p.kind)
  const taken = new Set([...friends.values()].map((f) => f.seat))
  const seat = spec.passengers.findIndex((_, i) => !taken.has(i))
  if (seat < 0) return relay(from, { k: 'ride_full', why: 'every seat is taken' })
  const look = playerLook(x.look)
  friends.set(from, { name: String(x.name || 'Friend').slice(0, 24), look, seat })
  // a passenger already in that seat hops off to make room
  riders.value = [...riders.value.filter((r: Rider) => r.seat !== seat), { key: `p-${from}`, seat, look, npc: false, id: from }]
  relay(from, { k: 'ride_seat', seat, kind: p.kind, color: p.owner === 'me' ? carColor.value : '', x: p.x, z: p.z, h: p.heading, y: ridePose.y, driverName: myName.value, driverLook: myLook(), label: spec.label })
  updateParty()
  ui.showToast(`${friends.get(from)!.name} hopped in 🙌`, 'success')
}
function driverLeave(from: string) {
  const f = friends.get(from)
  if (!f) return
  friends.delete(from)
  riders.value = riders.value.filter((r: Rider) => r.id !== from)
  updateParty()
  ui.showToast(`${f.name} got out`, 'info')
}
let poseSent = 0
function streamPose(p: Parked) {
  if (!friends.size) return
  const now = performance.now()
  if (now - poseSent < 200) return
  poseSent = now
  const others = [...friends.entries()].map(([id, f]) => ({ id, seat: f.seat, look: f.look }))
  const npcs = riders.value.filter((r: Rider) => r.npc).map((r: Rider) => ({ seat: r.seat, n: r.npcId }))
  for (const id of friends.keys()) {
    relay(id, { k: 'ride_pose', x: +p.x.toFixed(2), z: +p.z.toFixed(2), h: +p.heading.toFixed(3), y: +ridePose.y.toFixed(2), pax: others.filter((o) => o.id !== id), npcs })
  }
}

// passenger: riding along in a friend's vehicle
let pax: null | { driver: string; driverName: string; kind: VehicleKind; seat: number; x: number; z: number; h: number; y: number; tx: number; tz: number; th: number; ty: number; group: THREE.Group; lastRx: number; driverLook: RLook } = null
function enterPassenger(from: string, x: any) {
  const kind = x.kind as VehicleKind
  if (!['car', 'keke', 'okada', 'bus', 'truck', 'boat', 'plane'].includes(kind)) return
  const spec = vehicleSpec(kind)
  const { group } = paintedVehicle(kind, x.color || undefined, ownedMat)
  group.position.set(x.x, x.y ?? 0, x.z)
  group.rotation.y = x.h
  root.add(group)
  pax = { driver: from, driverName: String(x.driverName || 'Driver'), kind, seat: x.seat, x: x.x, z: x.z, h: x.h, y: x.y ?? 0, tx: x.x, tz: x.z, th: x.h, ty: x.y ?? 0, group, lastRx: performance.now(), driverLook: playerLook(x.driverLook) }
  ride.value.active = true
  ride.value.kind = kind
  ride.value.name = `${pax.driverName}'s ${x.label ?? spec.label}`
  ride.value.inner = false
  ride.value.prompt = null
  ridePose.active = true
  ridePose.cabin = spec.cockpit[1]
  ridePose.cockpitFwd = spec.cockpit[0]
  ridePose.x = x.x
  ridePose.z = x.z
  ridePose.heading = x.h
  avatarVisible.value = true
  avatarMode.value = 'sit'
  riders.value = [{ key: `drv-${from}`, seat: -1, look: pax.driverLook, npc: false, id: from }]
  riderMode.value = 'sit'
  riderKind.value = kind
  party.value = { role: 'passenger', seatsFree: 0, names: [pax.driverName] }
  partyIds.value = [from]
  socketSend.value('ride.state', { kind, driver: from, seat: x.seat })
  orbit.value.dist = Math.max(orbit.value.dist, kind === 'bus' ? 13 : 9)
  ui.showToast(`Riding with ${pax.driverName} 🚗 · E to get out`, 'success')
}
function passengerPose(x: any) {
  if (!pax) return
  pax.tx = x.x
  pax.tz = x.z
  pax.th = x.h
  pax.ty = x.y ?? 0
  pax.lastRx = performance.now()
  const next: Rider[] = [{ key: `drv-${pax.driver}`, seat: -1, look: pax.driverLook, npc: false, id: pax.driver }]
  for (const o of x.pax ?? []) next.push({ key: `p-${o.id}`, seat: o.seat, look: playerLook(o.look), npc: false, id: o.id })
  for (const n of x.npcs ?? []) next.push({ key: `npc-${n.n}`, seat: n.seat, look: npcLook(n.n), npc: true, npcId: n.n })
  const sig = next.map((r) => r.key + r.seat).join(',')
  if (sig !== riders.value.map((r: Rider) => r.key + r.seat).join(',')) riders.value = next
  partyIds.value = next.filter((r) => r.id).map((r) => r.id!)
}
function updatePassenger(dt: number) {
  const P = pax!
  const k = 1 - Math.exp(-dt * 6)
  P.x += (P.tx - P.x) * k
  P.z += (P.tz - P.z) * k
  P.y += (P.ty - P.y) * k
  let dh = P.th - P.h
  dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  P.h += dh * k
  P.group.position.set(P.x, P.y, P.z)
  P.group.rotation.y = P.h
  const [sx, sy, sz] = seatPoint(P.kind, P.seat, P.x, P.z, P.h, P.y)
  fig.x = sx
  fig.y = P.y
  fig.z = sz
  seatH.value = sy - P.y
  fig.h = P.h
  placeAvatar()
  const a = avatarRef.value
  if (a) a.visible = !ride.value.inner
  placeRiders(P.kind, P.x, P.z, P.h, P.y)
  ridePose.x = P.x
  ridePose.z = P.z
  ridePose.y = P.y
  ridePose.heading = P.h
  playerPos.value = [P.x, 0, P.z]
  playerFacing.value = P.h
  const now = performance.now()
  if (now - lastSent > 110) {
    lastSent = now
    socketSend.value('player.move', { position: [P.x, 0, P.z], facing: P.h })
  }
  if (now - P.lastRx > 8000) {
    exitPassenger(false)
    ui.showToast('Lost the driver - you got out.', 'info')
  }
}
function exitPassenger(notify: boolean) {
  const P = pax
  if (!P) return
  if (notify) relay(P.driver, { k: 'ride_leave' })
  root.remove(P.group)
  const spec = vehicleSpec(P.kind)
  const lat = P.seat >= 0 ? (spec.passengers[P.seat]?.[0] ?? 0.4) : spec.seat[0]
  const out = (lat < 0 ? -1 : 1) * (spec.radius + 0.7)
  const [ex, ez] = unstick(...clampBounds(P.x + Math.cos(P.h) * out, P.z - Math.sin(P.h) * out))
  playerPos.value = [ex, 0, ez]
  socketSend.value('player.move', { position: [ex, 0, ez], facing: P.h })
  ride.value.active = false
  ride.value.kind = null
  ride.value.name = ''
  ride.value.inner = false
  ride.value.speed = 0
  ridePose.active = false
  avatarVisible.value = false
  riders.value = []
  party.value = { role: 'none', seatsFree: 0, names: [] }
  partyIds.value = []
  socketSend.value('ride.state', { kind: null })
  pax = null
}

const lookKey = computed(() => JSON.stringify(sim.look))
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
      ride.value.prompt = n ? (n.owner === 'me' ? 'Drive your car' : n.owner ? `🔒 ${n.ownerName}'s car` : `Board ${vehicleSpec(n.kind).label}`) : null
    }
  }

  // someone driving their own car: hide its parked copy (it's on the road)
  ghostTimer += dt
  if (ghostTimer > 1) {
    ghostTimer = 0
    const driving = new Set(players.value.players.filter((pl: any) => typeof pl.riding === 'string' && pl.riding.startsWith('car|' + pl.id)).map((pl) => pl.id))
    for (const f of fleet) if (f.owner && f.owner !== 'me' && f.mesh) f.mesh.visible = !driving.has(f.owner)
  }
  if (pax) {
    updatePassenger(dt)
    return
  }
  if (!ride.value.active || !current) return
  if (phase.value !== 'riding') {
    // Boarding/exit phases are pure cosmetic interpolation (no physics, no
    // collision), so they can take big time steps: on a slow machine that
    // clamps to 0.1s per frame the walk-in would otherwise take a minute of
    // wall time. Driving below keeps the tight 0.1s clamp for tunneling.
    animatePhase(Math.min(delta || 0.016, 0.45))
    placeAvatar()
    if (current) placeRiders(current.kind, current.x, current.z, current.heading, ridePose.y)
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
    // your car tier (Corolla → Hilux → G-Wagon) makes your car faster
    const boost = p.owner === 'me' ? 1 + 0.12 * (p.tier ?? carTier.value) : 1
    speed += throttle * spec.accel * boost * dt
    if (throttle < 0 && speed > 0) speed -= spec.accel * 1.4 * dt // brake
    // engine drag rolls the vehicle to a stop when the throttle is released
    if (Math.abs(throttle) < 0.05 && Math.abs(speed) > 0) {
      const drop = 4.5 * dt
      speed = Math.abs(speed) <= drop ? 0 : speed - Math.sign(speed) * drop
    }
    speed = Math.max(-spec.maxSpeed * 0.4, Math.min(spec.maxSpeed * boost, speed))
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
    fig.y = ridePose.y
    fig.z = hz
    fig.h = p.heading
    seatH.value = hy - ridePose.y
    avatarMode.value = 'sit'
    placeAvatar()
    const a = avatarRef.value
    if (a) {
      a.visible = !ride.value.inner
      a.rotation.z = p.mesh ? p.mesh.rotation.z : 0
    }
    placeRiders(p.kind, p.x, p.z, p.heading, ridePose.y, p.mesh ? p.mesh.rotation.z : 0)
    streamPose(p)
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
  ;(window as any).__kk_fleet = () => fleet.map((f) => [f.kind, +f.x.toFixed(1), +f.z.toFixed(1), f.owner ?? '', +f.heading.toFixed(2)])
  ;(window as any).__kk_riders = () => riders.value.map((r: Rider) => [r.key, r.seat])
  ;(window as any).__kk_party = () => ({ ...party.value })
  // test hook: stand at a vehicle's door (by fleet index) and get in
  ;(window as any).__kk_board_at = (i: number) => {
    const f = fleet[i]
    if (!f) return false
    const [sx, sz] = doorStand(f)
    playerPos.value = [sx, 0, sz]
    socketSend.value('player.move', { position: [sx, 0, sz], facing: 0 })
    ;(window as any).__kk_teleport_at = Date.now()
    ride.value.prompt = 'test'
    board()
    return phase.value
  }
}
</script>

<template>
  <TresGroup>
    <primitive :object="root" />
    <!-- you, getting in and sitting at the wheel (or in your seat) -->
    <TresGroup ref="avatarRef" :visible="false">
      <CharacterAvatar
        real
        :key="lookKey"
        :shirt="sim.look.top"
        :trouser="sim.look.bottom"
        :skin="sim.look.skin"
        :kufi="sim.look.hair === 'cap'"
        :hijab="sim.look.outfit === 'dress'"
        :hair-style="sim.look.hair"
        :hair-color="sim.look.hairColor"
        :outfit="sim.look.outfit"
        :gadgets="(sim.look.gadgets ?? []) as any"
        :print="sim.look.print"
        :scarf="sim.look.hairColor"
        :mode="avatarMode"
        :seat="seatH"
        :gait-speed="10.5"
      />
    </TresGroup>
    <!-- everyone else in the vehicle: passengers, friends, the driver -->
    <TresGroup v-for="r in riders" :key="r.key" :ref="(el: any) => setRiderRef(r.key, el)">
      <CharacterAvatar
        real
        :female="r.look.female"
        :skin="r.look.skin"
        :shirt="r.look.top"
        :trouser="r.look.bottom"
        :hair-color="r.look.hairColor"
        :hair-style="(r.look.hair as any)"
        :kufi="r.look.hair === 'cap'"
        :hijab="r.look.outfit === 'dress' && r.npc === false"
        :outfit="(r.look.outfit as any)"
        :gadgets="(r.look.gadgets ?? []) as any"
        :mode="riderMode"
        :seat="riderSeat(r.seat)"
        :phase="r.key.length * 0.37"
      />
    </TresGroup>
  </TresGroup>
</template>
