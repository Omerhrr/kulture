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
import { BAKE, roadW, PLAYABLE_POS } from '~/utils/kaduna'
import { SITES, hash01 } from '~/utils/kadunaExtras'
import { crosswalks, type Crosswalk } from '~/utils/kadunaLighting'
import { collidesRadius } from '~/utils/collision'
import { laneBlocked, threatNear, trafficProbe } from '~/utils/trafficProbe'
import { pedRegistry, pedRegistryPush, pedRegistryReset, pedName, pedLine, pedClock, type PedKind } from '~/utils/peds'
import { useIsTouch, useInterior } from '~/composables/useControlsState'
import { registerCrash, meleeHits, hitNamed } from '~/utils/impact'
import { weather } from '~/utils/weather'
import { kkAudio } from '~/utils/audio'
import { sunState } from '~/composables/useTimeOfDay'
import { crowd, routineLine } from '~/utils/crowdShared'
import { nearestSeat } from '~/utils/seats'

const isTouch = useIsTouch()
const interiorRef = useInterior()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
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
  routes.push({ pts: flat, cum, total, mid: [mid[0], mid[1]], rw: roadW(r) })
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
  /** knocked down by a vehicle: seconds since the hit (-1 = standing) */
  knock?: number
  /** punched and ANGRY: seconds left chasing the player to swing back */
  grudge?: number
  /** seconds until the next swing while holding a grudge */
  swingCd?: number
  /** what they carry: 0 none, 1 shopping bag, 2 phone, 3 basin on the head, 4 backpack, 5 briefcase */
  item?: number
  /** opens an umbrella when it rains */
  umbrella?: boolean
  kvx?: number
  kvz?: number
  /** zone tag for district occupants (textile, kawo, rigasa, kasu, sabon) */
  zone?: string
  /** anchored pose: seated on a bench */
  sit?: boolean
  /** standing gossip pair (KASU campus walk) */
  gossip?: boolean
  /** gone home for the night (parked below the city until dawn) */
  sleep?: boolean
  /** night factor at which this person goes home (2 = never) */
  homeAt?: number
  /** stays out after dark (night owls, about a quarter of the city) */
  nightOwl?: boolean
  /** colours (for the high-detail renderer) */
  look?: { shirt: string; trouser: string; skin: string; hair: string }
  /** drawn by the high-detail LOD renderer instead of the instanced crowd */
  hd?: boolean
  /** street seat they are heading to / sitting on (lunch, evening rest) */
  rest?: { x: number; z: number; yaw: number; h: number; until: number; stuck: number }
  /** seat height for a seated pose (default: Rigasa platform bench) */
  seatH?: number
  restCheck?: number
}

const N_WALK = isTouch.value ? 20 : 36
const N_HAWK = isTouch.value ? 6 : 10
const N_VEND = isTouch.value ? 10 : 14
const N_WORK = isTouch.value ? 4 : 6
const N_KID = isTouch.value ? 4 : 6
const N_SHOP = isTouch.value ? 6 : 10
const TOTAL = N_WALK + N_HAWK + N_VEND + N_WORK + N_KID + N_SHOP

const CROSSWALKS = crosswalks()
const SIDEWALK = 1.4 // walk line out from the asphalt edge (sidewalk is 2.6 m)

const peds: Ped[] = []
crowd.peds = peds
const takenSeats = new Set<number>()
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

// district occupants: stall keepers, drivers, sitters and a queue at the
// five new spots. Anchors mirror the WorldScene build grids (the Textile
// stall rows, the Kawo keke line, the Rigasa benches, the KASU platform
// walk, the Sabon shop front).
const PP = PLAYABLE_POS
const rel = (code: string, pts: Array<[number, number]>): Array<[number, number]> =>
  pts.map(([x, z]) => [PP[code][0] + x, PP[code][1] + z] as [number, number])
const TEXTILE_VENDORS = rel('textile_market', [
  [-7, -0.8], [0, -0.8], [7, -0.8],
  [-7, 7.2], [0, 7.2], [7, 7.2]
])
const KAWO_DRIVERS = rel('kawo_motor_park', [[-3.3, 5.3], [1.7, 5.6], [6.4, 5.0]])
const RIGASA_SITTERS = rel('rigasa_station', [[-6.8, 1.4], [-5.2, 1.4], [5.2, 1.4], [6.8, 1.4]])
const KASU_PAIR = rel('kasu_gate', [[-2.4, 1.7], [-1.1, 2.3]])
const SABON_QUEUE = rel('sabon_tasha_shop', [[1.8, 6.9]])
const SIT_TOP = 1.5 // Rigasa bench seat height above the street

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
  const nightOwl = hash01(i, 9.17) < 0.28
  p.nightOwl = nightOwl
  if (i < N_WALK + N_HAWK) {
    seedWalker(p, i < N_WALK ? 'walker' : 'hawker')
    p.homeAt = nightOwl ? 2 : 0.78
  } else if (i < N_WALK + N_HAWK + N_VEND) {
    const k = i - N_WALK - N_HAWK
    p.kind = 'vendor'
    if (k < 8) {
      // the central market sheds (floodlit, staffed round the clock)
      const [vx, vz] = vendorSpots[k % vendorSpots.length]
      p.ax = vx
      p.az = vz
      p.heading = Math.PI + hash01(vx, vz) - 0.5
      p.homeAt = 2
    } else {
      // stall keepers at the Textile Market (go home after dark)
      const [vx, vz] = TEXTILE_VENDORS[(k - 8) % TEXTILE_VENDORS.length]
      p.ax = vx
      p.az = vz
      p.heading = Math.PI + hash01(vx, vz) - 0.5
      p.item = k % 2 ? 1 : 0
      p.zone = 'textile'
      p.homeAt = 0.72
    }
  } else if (i < N_WALK + N_HAWK + N_VEND + N_WORK) {
    const k = i - N_WALK - N_HAWK - N_VEND
    p.kind = 'worker'
    if (k < 3) {
      const site = SITES[k % Math.max(1, SITES.length)]
      p.ax = site.x - 5 + (k % 3) * 4
      p.az = site.z + 6.6
      p.heading = Math.PI
      p.homeAt = 2
    } else if (k < 5) {
      // drivers waiting by the Kawo keke line (transport runs all night)
      const [wx, wz] = KAWO_DRIVERS[k - 3]
      p.ax = wx
      p.az = wz
      p.heading = Math.PI + (k - 3) * 0.35
      p.zone = 'kawo'
      p.homeAt = 2
    } else {
      // the queue under the Sabon Tasha shop awning
      const [qx, qz] = SABON_QUEUE[k - 5]
      p.ax = qx
      p.az = qz
      p.heading = Math.PI
      p.zone = 'sabon'
      p.homeAt = 0.72
    }
  } else if (i < N_WALK + N_HAWK + N_VEND + N_WORK + N_KID) {
    const k = i - N_WALK - N_HAWK - N_VEND - N_WORK
    p.kind = 'kid'
    p.ax = PITCH[0]
    p.az = PITCH[1]
    p.orbit = 4 + k * 1.4
    p.speed = 2.6 + k * 0.35
    p.phase = (k / N_KID) * Math.PI * 2
    p.homeAt = 0.6
  } else {
    const k = i - N_WALK - N_HAWK - N_VEND - N_WORK - N_KID
    p.kind = 'shopper'
    p.speed = 1.1 + Math.random() * 0.6
    p.homeAt = nightOwl ? 2 : 0.78
    if (k < 4) {
      // browsing the central market
      p.tx = market.x + (Math.random() - 0.5) * 44
      p.tz = market.z + (Math.random() - 0.5) * 30
      p.x = p.tx
      p.z = p.tz
      pickShopperTarget(p)
    } else if (k < 8) {
      // waiting on a Rigasa bench, facing the platform edge
      const [bx, bz] = RIGASA_SITTERS[k - 4]
      p.sit = true
      p.zone = 'rigasa'
      p.homeAt = 2
      p.x = bx
      p.z = bz
      p.tx = bx
      p.tz = bz
      p.heading = 0
    } else {
      // a gossip pair on the KASU campus walk
      const [gx, gz] = KASU_PAIR[k - 8]
      p.gossip = true
      p.zone = 'kasu'
      p.homeAt = 0.72
      p.x = gx
      p.z = gz
      p.tx = gx
      p.tz = gz
      p.heading =
        k === 8
          ? Math.atan2(KASU_PAIR[1][0] - KASU_PAIR[0][0], KASU_PAIR[1][1] - KASU_PAIR[0][1])
          : Math.atan2(KASU_PAIR[0][0] - KASU_PAIR[1][0], KASU_PAIR[0][1] - KASU_PAIR[1][1])
    }
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
// jointed limbs: upper + lower segment per side (the same rig the player
// avatar uses, so the crowd walks with real knees and elbows)
let legM: THREE.InstancedMesh | null = null
let legM2: THREE.InstancedMesh | null = null
let armM: THREE.InstancedMesh | null = null
let armM2: THREE.InstancedMesh | null = null
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
// carried items (one instance slot per ped, hidden with a zero matrix)
let bagM: THREE.InstancedMesh | null = null
let phoneM: THREE.InstancedMesh | null = null
let basinM: THREE.InstancedMesh | null = null
let packM: THREE.InstancedMesh | null = null
let caseM: THREE.InstancedMesh | null = null
let umbM: THREE.InstancedMesh | null = null
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
  const nrm = new Float32Array(total * 3)
  let off = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, off)
    // keep the smooth normals of the source shapes (no faceted heads)
    if (g.attributes.normal) nrm.set(g.attributes.normal.array as Float32Array, off)
    off += g.attributes.position.count * 3
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  for (const g of geos) g.dispose()
  return out
}

onMounted(() => {
  const g = groupRef.value
  if (!g) return

  // realistic adult proportions, matching CharacterAvatar (1.78 m, head
  // = 1/7.5 of the body). Parts are authored in the ped's local frame.
  const torsoCyl = new THREE.CylinderGeometry(0.19, 0.165, 0.55, 12)
  torsoCyl.scale(1, 1, 0.66)
  torsoCyl.translate(0, 1.24, 0)
  const shoulders = new THREE.SphereGeometry(0.19, 12, 8)
  shoulders.scale(1.05, 0.42, 0.68)
  shoulders.translate(0, 1.45, 0)
  const pelvis = new THREE.SphereGeometry(0.17, 12, 8)
  pelvis.scale(1, 0.62, 0.72)
  pelvis.translate(0, 0.96, 0)
  const torsoGeo = mergeGeos([torsoCyl, shoulders, pelvis])
  const skull = new THREE.SphereGeometry(0.112, 14, 10)
  skull.scale(0.9, 1.08, 1)
  skull.translate(0, 1.68, 0)
  const jaw = new THREE.SphereGeometry(0.08, 10, 8)
  jaw.scale(0.95, 0.75, 1)
  jaw.translate(0, 1.625, 0.03)
  const neck = new THREE.CylinderGeometry(0.052, 0.058, 0.12, 8)
  neck.translate(0, 1.56, 0.005)
  const headGeo = mergeGeos([skull, jaw, neck])
  // two-segment legs (thigh -> knee -> shin + shoe), matching CharacterAvatar
  const thigh = new THREE.CapsuleGeometry(0.075, 0.34, 3, 8)
  thigh.translate(0, -0.26, 0)
  const shin = new THREE.CapsuleGeometry(0.058, 0.3, 3, 8)
  shin.translate(0, -0.23, 0)
  const foot = new THREE.BoxGeometry(0.1, 0.08, 0.25)
  foot.translate(0, -0.42, 0.05)
  const legLower = mergeGeos([shin, foot])
  // two-segment arms (upper arm -> elbow -> forearm + hand)
  const upArm = new THREE.CapsuleGeometry(0.05, 0.24, 3, 8)
  upArm.translate(0, -0.16, 0)
  const fore = new THREE.CapsuleGeometry(0.042, 0.2, 3, 8)
  fore.translate(0, -0.15, 0)
  const hand = new THREE.SphereGeometry(0.046, 8, 6)
  hand.scale(0.8, 1.15, 0.6)
  hand.translate(0, -0.28, 0.01)
  const armLower = mergeGeos([fore, hand])
  const trayGeo = new THREE.BoxGeometry(0.55, 0.06, 0.55)
  trayGeo.translate(0, 1.86, 0)
  const goodsGeo = new THREE.BoxGeometry(0.34, 0.16, 0.34)
  goodsGeo.translate(0, 1.97, 0)
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
  const eyeL = new THREE.SphereGeometry(0.018, 8, 6)
  eyeL.scale(1.2, 0.8, 0.6)
  eyeL.translate(-0.038, 1.692, 0.094)
  const eyeR = new THREE.SphereGeometry(0.018, 8, 6)
  eyeR.scale(1.2, 0.8, 0.6)
  eyeR.translate(0.038, 1.692, 0.094)
  const eyesGeo = mergeGeos([eyeL, eyeR])
  const pupL = new THREE.SphereGeometry(0.0095, 6, 5)
  pupL.translate(-0.038, 1.692, 0.103)
  const pupR = new THREE.SphereGeometry(0.0095, 6, 5)
  pupR.translate(0.038, 1.692, 0.103)
  const pupilsGeo = mergeGeos([pupL, pupR])
  const browL = new THREE.BoxGeometry(0.042, 0.009, 0.012)
  browL.translate(-0.038, 1.721, 0.097)
  const browR = new THREE.BoxGeometry(0.042, 0.009, 0.012)
  browR.translate(0.038, 1.721, 0.097)
  const browGeo = mergeGeos([browL, browR])
  const noseGeo = new THREE.ConeGeometry(0.02, 0.045, 6)
  noseGeo.rotateX(Math.PI / 2.4)
  noseGeo.translate(0, 1.668, 0.108)
  const mouthGeo = new THREE.BoxGeometry(0.052, 0.012, 0.014)
  mouthGeo.translate(0, 1.618, 0.094)
  // hair: cap shell + back volume (hidden for hijab wearers)
  const hairCap = new THREE.SphereGeometry(0.116, 12, 8, 0, Math.PI * 2, 0, 1.45)
  hairCap.scale(0.93, 0.98, 1)
  hairCap.translate(0, 1.7, -0.008)
  const hairBack = new THREE.SphereGeometry(0.09, 8, 6)
  hairBack.scale(1, 1.1, 0.7)
  hairBack.translate(0, 1.66, -0.06)
  const hairGeo = mergeGeos([hairCap, hairBack])
  const hijabHead = new THREE.SphereGeometry(0.13, 12, 9)
  hijabHead.scale(0.95, 1.08, 1.02)
  hijabHead.translate(0, 1.69, -0.012)
  const hijabDrape = new THREE.CylinderGeometry(0.11, 0.26, 0.3, 12, 1, true)
  hijabDrape.scale(1, 1, 0.85)
  hijabDrape.translate(0, 1.52, -0.01)
  const hijabGeo = mergeGeos([hijabHead, hijabDrape])
  const skirtGeo = new THREE.CylinderGeometry(0.19, 0.36, 0.98, 12, 1, true)
  skirtGeo.scale(1, 1, 0.8)
  skirtGeo.translate(0, 0.58, 0)

  const plain = (color: string) => new THREE.MeshLambertMaterial({ color })
  torsoM = new THREE.InstancedMesh(torsoGeo, new THREE.MeshLambertMaterial(), TOTAL)
  headM = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), TOTAL)
  legM = new THREE.InstancedMesh(thigh, new THREE.MeshLambertMaterial(), TOTAL * 2)
  legM2 = new THREE.InstancedMesh(legLower, new THREE.MeshLambertMaterial(), TOTAL * 2)
  armM = new THREE.InstancedMesh(upArm, new THREE.MeshLambertMaterial(), TOTAL * 2)
  armM2 = new THREE.InstancedMesh(armLower, new THREE.MeshLambertMaterial(), TOTAL * 2)
  trayM = new THREE.InstancedMesh(trayFull, new THREE.MeshLambertMaterial(), TOTAL)
  eyesM = new THREE.InstancedMesh(eyesGeo, plain('#f2f0ea'), TOTAL)
  pupilsM = new THREE.InstancedMesh(pupilsGeo, plain('#14100e'), TOTAL)
  browM = new THREE.InstancedMesh(browGeo, new THREE.MeshLambertMaterial(), TOTAL)
  noseM = new THREE.InstancedMesh(noseGeo, new THREE.MeshLambertMaterial(), TOTAL)
  mouthM = new THREE.InstancedMesh(mouthGeo, plain('#5a3028'), TOTAL)
  hairM = new THREE.InstancedMesh(hairGeo, new THREE.MeshLambertMaterial(), TOTAL)
  hijabM = new THREE.InstancedMesh(hijabGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), TOTAL)
  skirtM = new THREE.InstancedMesh(skirtGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), TOTAL)

  torsoM.castShadow = headM.castShadow = legM.castShadow = true
  const all = [torsoM, headM, legM, legM2, armM, armM2, trayM, eyesM, pupilsM, browM, noseM, mouthM, hairM, hijabM, skirtM]
  // ---- things people carry
  const bagGeo = mergeGeos([
    new THREE.BoxGeometry(0.3, 0.32, 0.12).translate(0, -0.2, 0),
    new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI).translate(0, -0.04, 0)
  ])
  const phoneGeo = new THREE.BoxGeometry(0.07, 0.14, 0.012)
  const basinGeo = mergeGeos([new THREE.CylinderGeometry(0.3, 0.2, 0.14, 14).translate(0, 0.07, 0), new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.2, 0.5, 1.2).translate(0, 0.13, 0)])
  const packGeo = new THREE.BoxGeometry(0.3, 0.4, 0.16)
  const caseGeo = mergeGeos([new THREE.BoxGeometry(0.4, 0.3, 0.09).translate(0, -0.18, 0), new THREE.BoxGeometry(0.1, 0.03, 0.03).translate(0, -0.02, 0)])
  const umbGeo = mergeGeos([
    new THREE.ConeGeometry(0.62, 0.3, 10, 1, true).translate(0, 0.55, 0),
    new THREE.CylinderGeometry(0.012, 0.012, 0.85, 4).translate(0, 0.12, 0)
  ])
  bagM = new THREE.InstancedMesh(bagGeo, new THREE.MeshLambertMaterial(), TOTAL)
  phoneM = new THREE.InstancedMesh(phoneGeo, plain('#15181c'), TOTAL)
  basinM = new THREE.InstancedMesh(basinGeo, new THREE.MeshLambertMaterial(), TOTAL)
  packM = new THREE.InstancedMesh(packGeo, new THREE.MeshLambertMaterial(), TOTAL)
  caseM = new THREE.InstancedMesh(caseGeo, plain('#2a1d14'), TOTAL)
  umbM = new THREE.InstancedMesh(umbGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), TOTAL)
  const itemMeshes = [bagM, phoneM, basinM, packM, caseM, umbM]
  const BAGS = ['#2f6fae', '#d8262e', '#f2f2ee', '#2f7d5b', '#e8b84b', '#6b4a8a']
  const UMB = ['#d8262e', '#1f4fa0', '#2f7d5b', '#e8b84b', '#1d1d20', '#c84a8a']
  const ic = new THREE.Color()
  for (let i = 0; i < TOTAL; i++) {
    const p = peds[i]
    const r = hash01(i * 13.1, 7.7)
    if (p.kind === 'kid') p.item = 4
    else if (p.kind === 'walker' || p.kind === 'shopper') {
      p.item = r < 0.22 ? 1 : r < 0.42 ? 2 : r < 0.56 && p.female ? 3 : r < 0.66 ? 5 : r < 0.74 ? 4 : 0
    } else p.item = 0
    p.umbrella = (p.kind === 'walker' || p.kind === 'shopper' || p.kind === 'kid') && hash01(i, 3.3) < 0.7
    bagM.setColorAt(i, ic.set(BAGS[i % BAGS.length]))
    basinM.setColorAt(i, ic.set(i % 2 ? '#c0c4ca' : '#d8a23c'))
    packM.setColorAt(i, ic.set(BAGS[(i + 2) % BAGS.length]))
    umbM.setColorAt(i, ic.set(UMB[i % UMB.length]))
  }
  for (const m of itemMeshes) {
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    all.push(m)
  }

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
    p.look = { shirt, trouser, skin, hair }
    c.set(shirt)
    torsoM!.setColorAt(i, c)
    c.set(skin)
    headM!.setColorAt(i, c)
    noseM!.setColorAt(i, c)
    // jointed limbs: females wear the dress outfit (legs = skin, like the
    // player avatar), males keep trousers; forearms and hands are skin
    const legColor = p.female ? skin : trouser
    for (let k = 0; k < 2; k++) {
      legM!.setColorAt(i * 2 + k, c.set(legColor))
      legM2!.setColorAt(i * 2 + k, c.set(legColor))
      armM!.setColorAt(i * 2 + k, c.set(shirt))
      armM2!.setColorAt(i * 2 + k, c.set(skin))
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
  for (const m of [torsoM, headM, legM, legM2, armM, armM2, trayM, eyesM, pupilsM, browM, noseM, mouthM, hairM, hijabM, skirtM]) m?.dispose()
})

// ---------------------------------------------------------------- update
const rootM = new THREE.Matrix4()
const itemM = new THREE.Matrix4()
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0)
const localM = new THREE.Matrix4()
const partM = new THREE.Matrix4()
const chainM = new THREE.Matrix4()
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

/** Jointed limb, exactly how CharacterAvatar animates: an upper segment
 *  pivoting at the root (hip / shoulder) and a lower segment pivoting at
 *  the joint (knee / elbow). upper[i] + lower[i] share the side slot. */
function twoSeg(
  upper: THREE.InstancedMesh,
  lower: THREE.InstancedMesh,
  i: number,
  root: THREE.Matrix4,
  px: number,
  py: number,
  pz: number,
  rx: number,
  jointLen: number,
  jrx: number
) {
  localM.compose(posV.set(px, py, pz), q.setFromEuler(eul.set(rx, 0, 0)), oneV)
  partM.multiplyMatrices(root, localM)
  upper.setMatrixAt(i, partM)
  localM.compose(posV.set(0, jointLen, 0), q.setFromEuler(eul.set(jrx, 0, 0)), oneV)
  chainM.multiplyMatrices(partM, localM)
  lower.setMatrixAt(i, chainM)
}

/** Back to a normal routine after a fight / fright: fresh route or fresh
 *  shopping target, matching what waking from sleep does. */
function reseedRoutine(p: Ped) {
  if (p.kind === 'walker' || p.kind === 'hawker') seedWalker(p, p.kind)
  else if (p.kind === 'shopper' && !p.sit && !p.gossip) pickShopperTarget(p)
}

/** Move with wall + vehicle sliding; returns false when fully blocked.
 *  The current position is passed as the origin so a pedestrian caught
 *  under a car can always walk out, but never walk into one. */
function slideMove(p: Ped, mx: number, mz: number): boolean {
  const r = 0.34
  if (!collidesRadius(p.x + mx, p.z + mz, r, p.x, p.z)) {
    p.x += mx
    p.z += mz
    return true
  }
  if (mx !== 0 && !collidesRadius(p.x + mx, p.z, r, p.x, p.z)) {
    p.x += mx
    return true
  }
  if (mz !== 0 && !collidesRadius(p.x, p.z + mz, r, p.x, p.z)) {
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
  const nightNow = sunState(clockHour.value).night
  const pv = trafficProbe.player
  const hits = meleeHits.splice(0) // this frame's punches / kicks / pushes
  const interiorNow = interiorRef.value.inside
  // the player's vehicle answers for named characters too (Musa, Mama
  // Chidi, ...): same knockdown treatment as the instanced crowd
  if (pv && trafficProbe.playerSpeed > 3 && !interiorNow) {
    hitNamed(
      pv.x,
      pv.z,
      Math.sin(pv.h),
      Math.cos(pv.h),
      2 + trafficProbe.playerSpeed * 0.5,
      pv.r + 0.9
    )
  }
  // publish ALL awake pedestrians so every driver brakes for them (and is
  // accountable when they still hit someone), not just the ones near you
  {
    const out = trafficProbe.peds
    out.length = 0
    for (const q of peds) {
      if (q.sleep || out.length >= 200) continue
      out.push(q)
    }
  }
  for (const p of peds) {
    // night rhythm: past their home hour they head in; waking re-seeds
    // them cleanly (fresh route, fresh stall-side target)
    const wantSleep = nightNow >= (p.homeAt ?? 2)
    if (wantSleep !== !!p.sleep) {
      p.sleep = wantSleep || undefined
      if (!wantSleep) {
        if (p.kind === 'walker' || p.kind === 'hawker') seedWalker(p, p.kind)
        else if (p.kind === 'shopper' && !p.sit && !p.gossip) {
          p.x = p.tx
          p.z = p.tz
          pickShopperTarget(p)
        }
      }
    }
    if (p.sleep) continue
    // punched / kicked / pushed by the player: thrown back, fall, get up.
    // People nearby scatter - a street fight draws a crowd that runs.
    if (hits.length && (p.knock ?? -1) < 0) {
      for (const h of hits) {
        const dx = p.x - h.x
        const dz = p.z - h.z
        const d = Math.hypot(dx, dz)
        if (d < h.reach && dx * h.dirX + dz * h.dirZ > -0.2) {
          p.knock = 0
          p.kvx = (h.dirX * 0.8 + (dx / (d || 1)) * 0.4) * h.power
          p.kvz = (h.dirZ * 0.8 + (dz / (d || 1)) * 0.4) * h.power
          p.heading = Math.atan2(-h.dirX, -h.dirZ)
          p.talking = 0
          kkAudio.impact(Math.min(1, h.power / 8))
          for (const q of peds) {
            if (q === p || q.sleep || (q.knock ?? -1) >= 0) continue
            if (Math.abs(q.x - p.x) < 11 && Math.abs(q.z - p.z) < 11) {
              q.flee = Math.max(q.flee, 2.6)
              q.talking = 0
            }
          }
          break
        }
      }
    }
    // run over by the player's vehicle: thrown, fall, lie, get up
    if (pv && trafficProbe.playerSpeed > 3 && (p.knock ?? -1) < 0) {
      const dx = p.x - pv.x
      const dz = p.z - pv.z
      const d = Math.hypot(dx, dz)
      if (d < pv.r + 0.35) {
        const sp = trafficProbe.playerSpeed
        const fx = Math.sin(pv.h)
        const fz = Math.cos(pv.h)
        p.knock = 0
        p.kvx = (fx * 0.8 + (dx / (d || 1)) * 0.6) * (2 + sp * 0.5)
        p.kvz = (fz * 0.8 + (dz / (d || 1)) * 0.6) * (2 + sp * 0.5)
        p.heading = Math.atan2(-fx, -fz)
        p.talking = 0
        registerCrash(Math.min(0.6, sp / 25))
        kkAudio.impact(Math.min(1, sp / 16))
      }
    }
    if ((p.knock ?? -1) >= 0) {
      p.knock! += dt
      const fr = Math.exp(-4 * dt)
      p.kvx! *= fr
      p.kvz! *= fr
      slideMove(p, p.kvx! * dt, p.kvz! * dt)
      p.swing = 0
      if (p.knock! > 3.2) {
        p.knock = -1
        // agency: some get up ANGRY and come back at you, the rest hurry
        // away and pick their routine back up
        if (hash01(p.id, 3.7) < 0.45) {
          p.grudge = 9
        } else {
          p.flee = 2.5
          reseedRoutine(p)
        }
      }
      continue
    }
    // holding a grudge: chase the player and swing back - on their own
    // accord, until you get far away or go indoors
    if ((p.grudge ?? 0) > 0) {
      p.grudge! -= dt
      const dx = px - p.x
      const dz = pz - p.z
      const d = Math.hypot(dx, dz) || 1
      if (interiorNow || d > 22) {
        p.grudge = 0
        reseedRoutine(p)
      } else {
        p.heading = Math.atan2(dx, dz)
        p.swing += dt * 15
        if (d > 1.2) {
          const sp = 3.3
          slideMove(p, (dx / d) * sp * dt, (dz / d) * sp * dt)
        } else {
          p.swingCd = (p.swingCd ?? 0) - dt
          if (p.swingCd <= 0) {
            p.swingCd = 1.5
            // the player staggers from the blow (same path remote players use)
            window.dispatchEvent(
              new CustomEvent('kk-player-hit', {
                detail: { dir: [dx / d, dz / d], action: 'punch', from: p.id }
              })
            )
            kkAudio.init()
            kkAudio.impact(0.45)
          }
        }
        continue
      }
    }
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

    if (p.kind === 'walker' && p.rest) {
      // daily routine: walk to a street seat, sit a while, carry on
      const r = p.rest
      if (!p.sit) {
        const dx = r.x - p.x
        const dz = r.z - p.z
        const d = Math.hypot(dx, dz)
        if (d < 0.4) {
          p.x = r.x
          p.z = r.z
          p.heading = r.yaw
          p.sit = true
          p.seatH = r.h
          p.swing = 0
          r.until = elapsed + 25 + Math.random() * 40
        } else {
          if (!slideMove(p, (dx / d) * p.speed * dt, (dz / d) * p.speed * dt)) r.stuck += dt
          p.heading = Math.atan2(dx, dz)
          p.swing += dt * p.speed * 5.6
          if (r.stuck > 6) {
            takenSeats.delete(r.x * 1e4 + r.z)
            p.rest = undefined
          }
        }
        continue
      }
      if (elapsed > r.until) {
        takenSeats.delete(r.x * 1e4 + r.z)
        p.sit = false
        p.seatH = undefined
        p.rest = undefined
        p.restCheck = elapsed + 60
        seedWalker(p, 'walker')
        p.x = r.x
        p.z = r.z
      }
      continue
    }
    if (p.kind === 'walker' && p.stage === 'walk' && elapsed > (p.restCheck ?? 0)) {
      p.restCheck = elapsed + 4 + Math.random() * 6
      const h = pedClock.hour
      const breakTime = (h >= 12 && h < 14.5) || (h >= 17.5 && h < 21)
      if (breakTime && Math.random() < 0.35) {
        const st = nearestSeat(p.x, p.z, 45)
        if (st && !takenSeats.has(st.x * 1e4 + st.z)) {
          takenSeats.add(st.x * 1e4 + st.z)
          p.rest = { x: st.x, z: st.z, yaw: st.yaw, h: st.h, until: 0, stuck: 0 }
          continue
        }
      }
    }
    if (p.kind === 'walker' || p.kind === 'hawker') {
      if (p.stage === 'walk') {
        // rush hour: commuters walk faster
        const h = pedClock.hour
        const rush = p.kind === 'walker' && ((h >= 6.5 && h < 9) || (h >= 16.5 && h < 19)) ? 1.3 : 1
        p.s += p.speed * rush * p.dir * dt
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
    if (a.sleep) continue
    for (let j = i + 1; j < peds.length; j++) {
      if (peds[j].sleep) continue
      const b = peds[j]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const d2 = dx * dx + dz * dz
      if (d2 > 0.56 || d2 < 1e-6) continue
      const d = Math.sqrt(d2)
      const push = (0.75 - d) * 0.5
      const ux = dx / d
      const uz = dz / d
      const aStatic = a.kind === 'vendor' || a.kind === 'worker' || a.sit || a.gossip
      const bStatic = b.kind === 'vendor' || b.kind === 'worker' || b.sit || b.gossip
      if (!aStatic) slideMove(a, -ux * push, -uz * push)
      if (!bStatic) slideMove(b, ux * push, uz * push)
    }
    // yield to the player: nobody phases through you, they step aside
    const pdx = a.x - px
    const pdz = a.z - pz
    const pd2 = pdx * pdx + pdz * pdz
    if (pd2 < 1.44 && pd2 > 1e-6 && !a.sleep) {
      const pd = Math.sqrt(pd2)
      const push = (1.2 - pd) * 0.85
      slideMove(a, (pdx / pd) * push, (pdz / pd) * push)
      if (a.kind !== 'vendor' && a.kind !== 'worker' && !a.sit && !a.gossip) a.heading = Math.atan2(pdx, pdz)
    }
  }

  // ------------------------------------------------- draw
  const rainNow = weather.cur.rain
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i]
    const sitting = !!p.sit
    const still = sitting || !!p.gossip
    const walking =
      !still &&
      (p.kind === 'walker' || p.kind === 'hawker' || p.kind === 'kid' || (p.kind === 'shopper' && Math.hypot(p.tx - p.x, p.tz - p.z) > 0.8))
    const wk = walking ? 1 : 0
    const sw = walking ? Math.sin(p.swing) : 0
    const s = p.height
    // gait bob, same amplitude the player avatar uses
    const bobY = walking ? Math.abs(Math.cos(p.swing)) * 0.035 - 0.012 : 0

    const kt = p.knock ?? -1
    if (p.sleep || p.hd) {
      // gone home (or drawn in high detail by CrowdLOD): parked below the city
      rootM.compose(posV.set(p.x, -420, p.z), q.identity(), scaleV.set(s, s, s))
    } else if (kt >= 0) {
      const lie = kt < 2.5 ? Math.min(1, kt / 0.3) : Math.max(0, 1 - (kt - 2.5) / 0.6)
      rootM.compose(
        posV.set(p.x, lie * 0.16 * s, p.z),
        q.setFromEuler(eul.set(-lie * Math.PI * 0.47, p.heading, 0, 'YXZ')),
        scaleV.set(s, s, s)
      )
      eul.order = 'XYZ'
    } else if (sitting) {
      // hips on the bench top, shins hanging to the platform
      rootM.compose(posV.set(p.x, (p.seatH ?? SIT_TOP) - 0.94 * s, p.z), q.setFromEuler(eul.set(0, p.heading, 0)), scaleV.set(s, s, s))
    } else {
      rootM.compose(posV.set(p.x, bobY, p.z), q.setFromEuler(eul.set(0, p.heading, 0)), scaleV.set(s, s, s))
    }
    torsoM.setMatrixAt(i, rootM)
    headM.setMatrixAt(i, rootM)
    // legs: hip swing + knee flex that peaks mid-swing (the player's gait)
    const stride = p.female ? 0.32 : 0.5
    const kneeAmp = p.female ? 0.5 : 0.72
    const kneeL = 0.08 + Math.max(0, Math.sin(p.swing - 1.2)) * kneeAmp * wk
    const kneeR = 0.08 + Math.max(0, Math.sin(p.swing - 1.2 + Math.PI)) * kneeAmp * wk
    if (sitting) {
      // thighs forward on the seat, shins down to the platform
      twoSeg(legM, legM2, i * 2, rootM, -0.1, 0.94, 0, -1.5, -0.47, 1.45)
      twoSeg(legM, legM2, i * 2 + 1, rootM, 0.1, 0.94, 0, -1.5, -0.47, 1.45)
    } else {
      twoSeg(legM, legM2, i * 2, rootM, -0.1, 0.94, 0, -sw * stride, -0.47, kneeL)
      twoSeg(legM, legM2, i * 2 + 1, rootM, 0.1, 0.94, 0, sw * stride, -0.47, kneeR)
    }
    // arms counter-swing the legs like the player rig, elbows bent
    const hammer = p.kind === 'worker' && !sitting ? -0.9 + Math.sin(elapsed * 6 + p.phase) * 0.55 : 0
    const shL = sitting ? -0.62 : p.kind === 'worker' ? hammer : sw * 0.42
    const shR = sitting ? -0.62 : p.kind === 'worker' ? hammer : -sw * 0.42
    const elL = sitting ? -0.5 : p.kind === 'worker' ? -0.5 : -(0.22 + Math.max(0, sw) * 0.25) * wk - 0.12
    const elR = sitting ? -0.5 : p.kind === 'worker' ? -0.5 : -(0.22 + Math.max(0, -sw) * 0.25) * wk - 0.12
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

    // carried items + umbrellas (rain)
    if (bagM && phoneM && basinM && packM && caseM && umbM) {
      const down = kt >= 0
      const it = down ? 0 : p.item ?? 0
      const umb = !down && p.umbrella && rainNow > 0.25
      // right hand lands where the two-segment arm ends
      const handY = 1.43 - 0.29 * Math.cos(shR) - 0.29 * Math.cos(shR + elR)
      const handZ = -0.29 * Math.sin(shR) - 0.29 * Math.sin(shR + elR)
      const ZM = ZERO_M
      bagM.setMatrixAt(i, it === 1 ? (localM.makeTranslation(0.25, handY, handZ), itemM.multiplyMatrices(rootM, localM)) : ZM)
      caseM.setMatrixAt(i, it === 5 ? (localM.makeTranslation(0.25, handY, handZ), itemM.multiplyMatrices(rootM, localM)) : ZM)
      basinM.setMatrixAt(i, it === 3 && !umb ? (localM.makeTranslation(0, 1.81, 0), itemM.multiplyMatrices(rootM, localM)) : ZM)
      packM.setMatrixAt(i, it === 4 ? (localM.makeTranslation(0, 1.25, -0.18), itemM.multiplyMatrices(rootM, localM)) : ZM)
      if (it === 2 && !umb) {
        // phone held up to the ear: left arm raised, elbow bent to the face
        twoSeg(armM, armM2, i * 2, rootM, -0.225, 1.43, 0, -1.15, -0.29, -1.15)
        localM.compose(posV.set(-0.13, 1.66, 0.09), q.setFromEuler(eul.set(0, 0.4, 0)), oneV)
        phoneM.setMatrixAt(i, itemM.multiplyMatrices(rootM, localM))
      } else {
        twoSeg(armM, armM2, i * 2, rootM, -0.225, 1.43, 0, shL, -0.29, elL)
        phoneM.setMatrixAt(i, ZM)
      }
      if (umb) {
        // umbrella held up in the right hand, canopy over the head
        twoSeg(armM, armM2, i * 2 + 1, rootM, 0.225, 1.43, 0, -1.75, -0.29, -0.55)
        localM.compose(posV.set(0.16, 1.62, 0.18), q.setFromEuler(eul.set(-0.15, 0, -0.12)), oneV)
        umbM.setMatrixAt(i, itemM.multiplyMatrices(rootM, localM))
      } else {
        twoSeg(armM, armM2, i * 2 + 1, rootM, 0.225, 1.43, 0, shR, -0.29, elR)
        umbM.setMatrixAt(i, ZM)
      }
    } else {
      twoSeg(armM, armM2, i * 2, rootM, -0.225, 1.43, 0, shL, -0.29, elL)
      twoSeg(armM, armM2, i * 2 + 1, rootM, 0.225, 1.43, 0, shR, -0.29, elR)
    }
  }
  for (const m of [torsoM, headM, legM, legM2, armM, armM2, trayM, eyesM, pupilsM, browM, noseM, mouthM, hairM, hijabM, skirtM, bagM, phoneM, basinM, packM, caseM, umbM]) {
    if (m) m.instanceMatrix.needsUpdate = true
  }

  // ------------------------------------------------- registry + prompt
  pedRegistryReset()
  for (const p of peds) {
    if (p.sleep) continue
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
      if (p.talking > 0 || p.sleep) continue
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
    text:
      p.kind === 'walker'
        ? routineLine(p.id, pedClock.hour, p.sit ? 'seated' : (pedClock.hour >= 6.5 && pedClock.hour < 9) || (pedClock.hour >= 16.5 && pedClock.hour < 19) ? 'commute' : 'walk')
        : pedLine(p.kind, pedClock.hour),
    engine: 'street_chat'
  }
}
void lastElapsed

// headless verification probe
if (import.meta.dev) {
  ;(window as any).__kk_crowd = () => ({
    total: peds.length,
    asleep: peds.filter((p) => p.sleep).length,
    walkers: peds.filter((p) => p.kind === 'walker' || p.kind === 'hawker').length,
    crossing: peds.filter((p) => p.stage === 'cross').length,
    waiting: peds.filter((p) => p.stage === 'wait').length,
    toCross: peds.filter((p) => p.stage === 'toCross').length,
    talking: peds.filter((p) => p.talking > 0).length,
    knocked: peds.filter((p) => (p.knock ?? -1) >= 0).length,
    grudges: peds.filter((p) => (p.grudge ?? 0) > 0).length,
    fleeing: peds.filter((p) => p.flee > 0).length,
    probePeds: trafficProbe.peds.length,
    firstPos: peds.length ? [+peds[0].x.toFixed(1), +peds[0].z.toFixed(1)] : null,
    probeCars: trafficProbe.cars.length,
    crosswalks: CROSSWALKS.map((c) => [+c.x.toFixed(0), +c.z.toFixed(0)]),
    walkerStages: peds
      .filter((p) => p.kind === 'walker')
      .slice(0, 6)
      .map((p) => [p.stage, Math.round(p.crossTimer)])
  })
  ;(window as any).__kk_nearest_ped = (kind?: string) => {
    const px = playerPos.value[0]
    const pz = playerPos.value[2]
    let best: Ped | null = null
    let bestD = Infinity
    for (const p of peds) {
      if (p.sleep) continue
      if (kind && p.kind !== kind) continue
      const d = Math.hypot(p.x - px, p.z - pz)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best ? [+best.x.toFixed(2), +best.z.toFixed(2), best.kind, +bestD.toFixed(1)] : null
  }
  ;(window as any).__kk_occupants = () => {
    const c: Record<string, number> = {}
    for (const p of peds) {
      if (!p.zone) continue
      c[p.zone] = (c[p.zone] || 0) + 1
    }
    c.sitters = peds.filter((p) => p.sit).length
    return c
  }
}
</script>

<template>
  <TresGroup ref="groupRef" />
</template>
