// venues - the city's public places, each a furnished interior with people
// living their lives in it: an office at work, a supermarket with shoppers
// and a cashier, a mall, a gym, a mosque with a jama'ah praying in rows, a
// church service, a bar, a restaurant, a hotel and a cinema.
//
// Local frame matches homes (utils/interiorRoom): door on +Z, W across x,
// D deep, floor at y = 0. Each venue returns its room (for the cut-away
// camera + colliders), the people in it (activity + where/how they are)
// and the spots the player can use (pray, run, order food, watch a film).
import * as THREE from 'three'
import { merge, box, rbox, cyl, sph, rotY, ankaraTex, screenTex, tileTex, woodTex, canvasTex, rng, type Part, type BuiltRoom, type RoomWall, type LocalBox } from '~/utils/interiorRoom'
import type { Activity } from '~/utils/poses'
import type { NeedKey } from '~/stores/sim'

export type VenueType = 'office' | 'supermarket' | 'mall' | 'gym' | 'mosque' | 'church' | 'bar' | 'restaurant' | 'hotel' | 'cinema'
export type ActorMode = Activity | 'idle' | 'walk' | 'sit' | 'sleep' | 'eat'

export interface VenueActor {
  id: number
  x: number
  z: number
  yaw: number
  mode: ActorMode
  seat?: number
  female?: boolean
  /** everyone with the same sync key moves together (congregational prayer) */
  sync?: boolean
  /** a staff member (uniform colours) */
  staff?: string
}
export interface VenueAction {
  label: string
  button: string
  need: NeedKey
  gain: number
  dur: number
  pose?: ActorMode
  /** server-priced service to pay for first (venues API) */
  service?: string
  stay?: boolean
  social?: number
}
export interface VenueSpot {
  id: string
  x: number
  z: number
  fx: number
  fz: number
  seat?: { x: number; z: number; h: number; yaw: number }
  act: VenueAction
}
export interface BuiltVenue {
  room: BuiltRoom
  actors: VenueActor[]
  spots: VenueSpot[]
  W: number
  D: number
}

export const VENUE_INFO: Record<VenueType, { label: string; size: [number, number]; names: string[]; icon: string }> = {
  office: { label: 'Office', size: [16, 12], icon: '🏢', names: ['Arewa Tech Hub', 'Zaria Road Consulting', 'Kaduna Business Centre', 'Sahel Fintech Ltd'] },
  supermarket: { label: 'Supermarket', size: [15, 13], icon: '🛒', names: ['Shoprite Ahmadu Bello Way', 'Mega Plaza Mart', 'Musa & Sons Superstore', 'Ummi Supermarket'] },
  mall: { label: 'Shopping mall', size: [24, 18], icon: '🛍️', names: ['Kaduna City Mall', 'Arewa Mall', 'Central Market Mall'] },
  gym: { label: 'Gym', size: [16, 12], icon: '🏋️', names: ['Iron Paradise Gym', 'Fit Arewa', 'Barnawa Fitness Club'] },
  mosque: { label: 'Mosque', size: [16, 14], icon: '🕌', names: ['Sultan Bello Mosque', 'Kaduna Central Mosque', 'Masjid Al-Noor'] },
  church: { label: 'Church', size: [16, 18], icon: '⛪', names: ['ECWA Goodnews Church', 'St. Joseph Catholic Church', 'Living Faith Chapel'] },
  bar: { label: 'Bar & lounge', size: [14, 11], icon: '🍻', names: ['Club Vibes Lounge', 'Mama Put & Bar', 'The Spot Lounge'] },
  restaurant: { label: 'Restaurant', size: [14, 12], icon: '🍛', names: ['Mai Suya Kitchen', 'Jollof Republic', 'Arewa Delicacies'] },
  hotel: { label: 'Hotel', size: [16, 13], icon: '🏨', names: ['Hamdala Hotel', 'Asaa Pyramid Hotel', 'Crocodile Hotel'] },
  cinema: { label: 'Cinema', size: [16, 16], icon: '🎬', names: ['Filmhouse Kaduna', 'Genesis Cinemas', 'Silverbird Kaduna'] }
}

const WALL_H = 3.4
const T = 0.2

// --------------------------------------------------------------- textures
const carpetTex = (a: string, b: string, key: string) =>
  canvasTex(key, 256, (g, s) => {
    g.fillStyle = a
    g.fillRect(0, 0, s, s)
    // prayer-row carpet: arched niches facing the qibla
    for (let i = 0; i < 4; i++) {
      const x = (i * s) / 4
      g.strokeStyle = b
      g.lineWidth = 6
      g.strokeRect(x + 6, 10, s / 4 - 12, s - 20)
      g.beginPath()
      g.arc(x + s / 8, 46, s / 8 - 14, Math.PI, 0)
      g.stroke()
      g.fillStyle = b
      g.globalAlpha = 0.35
      g.fillRect(x + 18, 80, s / 4 - 36, s - 110)
      g.globalAlpha = 1
    }
  })
const concreteTex = () =>
  canvasTex('gym-floor', 256, (g, s) => {
    g.fillStyle = '#2b2d31'
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2)
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'
    g.lineWidth = 2
    g.strokeRect(0, 0, s, s)
  })
const filmTex = () =>
  canvasTex('film', 512, (g, s) => {
    const gr = g.createLinearGradient(0, 0, s, s * 0.6)
    gr.addColorStop(0, '#f2a03a')
    gr.addColorStop(0.5, '#c84a6a')
    gr.addColorStop(1, '#2a3a7a')
    g.fillStyle = gr
    g.fillRect(0, 0, s, s * 0.56)
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.beginPath()
    g.arc(s * 0.3, s * 0.36, s * 0.12, 0, Math.PI * 2)
    g.fill()
    g.fillRect(s * 0.55, s * 0.2, s * 0.08, s * 0.3)
    g.fillStyle = '#fff'
    g.font = `bold ${s * 0.06}px sans-serif`
    g.fillText('NOLLYWOOD NIGHTS', s * 0.08, s * 0.5)
  })

// --------------------------------------------------------------- shell
interface Shell {
  group: THREE.Group
  walls: RoomWall[]
  colliders: LocalBox[]
  disposables: Array<{ dispose: () => void }>
  std: (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial
  add: (geo: THREE.BufferGeometry, mat: THREE.Material, shadow?: boolean) => THREE.Mesh
  P: Part[]
  G: Part[]
  E: Part[]
}

function shell(W: number, D: number, floorTex: THREE.Texture, rep: number, wallCol: string, opts: { windows?: boolean; dark?: boolean; light?: string } = {}): Shell {
  const group = new THREE.Group()
  const walls: RoomWall[] = []
  const colliders: LocalBox[] = []
  const disposables: Array<{ dispose: () => void }> = []
  const std = (o: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o })
    disposables.push(m)
    return m
  }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = shadow
    m.receiveShadow = true
    group.add(m)
    disposables.push(geo)
    return m
  }
  const t = floorTex.clone()
  t.needsUpdate = true
  t.repeat.set(W / rep, D / rep)
  disposables.push(t)
  add(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(0, 0.005, 0), std({ map: t, roughness: 0.6 }), false)
  add(box(W + 0.4, 0.2, D + 0.4, 0, -0.1, 0), std({ color: '#6a6458' }), false)
  const wallMat = std({ color: wallCol, roughness: 0.92 })
  const wall = (len: number, along: 'x' | 'z', cx: number, cz: number, nx: number, nz: number, gaps: Array<[number, number]> = [], windows: Array<[number, number]> = []) => {
    const holder = new THREE.Group()
    const segs: Array<[number, number]> = []
    let s0 = -len / 2
    for (const [g0, gw] of gaps) {
      if (g0 - gw / 2 > s0) segs.push([s0, g0 - gw / 2])
      s0 = g0 + gw / 2
    }
    if (s0 < len / 2) segs.push([s0, len / 2])
    for (const [a, b] of segs) {
      const l = b - a
      const m = (a + b) / 2
      const g = along === 'x' ? box(l, WALL_H, T, m, WALL_H / 2, 0) : box(T, WALL_H, l, 0, WALL_H / 2, m)
      const mesh = new THREE.Mesh(g, wallMat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      holder.add(mesh)
      disposables.push(g)
      colliders.push(along === 'x' ? { x: cx + m, z: cz, w: l, d: T + 0.1 } : { x: cx, z: cz + m, w: T + 0.1, d: l })
    }
    for (const [wPos, wW] of opts.windows === false ? [] : windows) {
      const glass = along === 'x' ? box(wW, 1.3, 0.04, wPos, 1.9, -0.11 * nz) : box(0.04, 1.3, wW, -0.11 * nx, 1.9, wPos)
      const gm = new THREE.Mesh(glass, std({ color: '#cfe6f0', emissive: '#bfe0f0', emissiveIntensity: opts.dark ? 0.05 : 0.6, roughness: 0.1 }))
      gm.userData.deco = true
      holder.add(gm)
      disposables.push(glass)
    }
    holder.position.set(cx, 0, cz)
    group.add(holder)
    walls.push({ mesh: holder, nx, nz, partition: false })
  }
  const win = (len: number) => {
    const out: Array<[number, number]> = []
    for (let p = -len / 2 + 2.2; p < len / 2 - 1.5; p += 3.2) out.push([p, 1.6])
    return out
  }
  wall(W, 'x', 0, -D / 2, 0, -1, [], win(W))
  wall(D, 'z', -W / 2, 0, -1, 0, [], win(D))
  wall(D, 'z', W / 2, 0, 1, 0, [], win(D))
  wall(W, 'x', 0, D / 2, 0, 1, [[0, 2.2]], [[-W / 4 - 0.6, 1.6], [W / 4 + 0.6, 1.6]])
  // lights: big warm fill + a few points so large rooms aren't dim
  const hemi = new THREE.HemisphereLight(opts.dark ? '#5a4a6a' : '#fff6e6', '#6a5a4a', opts.dark ? 0.35 : 0.9)
  hemi.position.set(0, 3, 0)
  group.add(hemi)
  for (const [lx, lz] of [
    [-W / 4, -D / 4],
    [W / 4, -D / 4],
    [-W / 4, D / 4],
    [W / 4, D / 4]
  ]) {
    const p = new THREE.PointLight(opts.light ?? '#ffe6c0', opts.dark ? 0.9 : 1.6, Math.max(W, D) * 0.9, 1.6)
    p.position.set(lx, WALL_H - 0.3, lz)
    group.add(p)
  }
  const backdrop = new THREE.Mesh(new THREE.BoxGeometry(W + 60, 40, D + 60), new THREE.MeshBasicMaterial({ color: '#1d1a17', side: THREE.BackSide, fog: false }))
  backdrop.position.y = 10
  group.add(backdrop)
  disposables.push(backdrop.geometry, backdrop.material as THREE.Material)
  return { group, walls, colliders, disposables, std, add, P: [], G: [], E: [] }
}

function finish(s: Shell): BuiltRoom {
  const furn = s.std({ vertexColors: true, roughness: 0.7 })
  const gloss = s.std({ vertexColors: true, roughness: 0.25, metalness: 0.15 })
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true })
  s.disposables.push(glow)
  if (s.P.length) s.add(merge(s.P), furn)
  if (s.G.length) s.add(merge(s.G), gloss)
  if (s.E.length) s.add(merge(s.E), glow, false)
  return {
    group: s.group,
    walls: s.walls,
    colliders: s.colliders,
    hotspots: [],
    dispose() {
      for (const d of s.disposables) d.dispose()
      s.group.clear()
    }
  }
}

// --------------------------------------------------------------- props
/** chair facing yaw (0 = +Z), seat height 0.47 */
function chair(P: Part[], x: number, z: number, yaw: number, col = '#2a2d33') {
  const g: Part[] = [
    [col, box(0.46, 0.06, 0.46, 0, 0.45, 0)],
    [col, box(0.46, 0.5, 0.06, 0, 0.72, -0.21)],
    ['#3a3d42', cyl(0.025, 0.025, 0.45, 0, 0.22, 0, 6)]
  ]
  for (const [c, geo] of g) P.push([c, rotY(geo, yaw, x, z)])
}
function deskUnit(P: Part[], G: Part[], E: Part[], x: number, z: number, yaw: number) {
  const parts: Array<[Part[], string, THREE.BufferGeometry]> = [
    [P, '#c8b89a', box(1.4, 0.05, 0.75, 0, 0.75, 0)],
    [P, '#5a5e66', box(0.05, 0.73, 0.7, -0.66, 0.37, 0)],
    [P, '#5a5e66', box(0.05, 0.73, 0.7, 0.66, 0.37, 0)],
    [G, '#1b1d22', box(0.62, 0.38, 0.04, 0, 1.03, -0.22)],
    [G, '#1b1d22', box(0.08, 0.2, 0.08, 0, 0.86, -0.22)],
    [G, '#2a2d33', box(0.45, 0.02, 0.15, 0, 0.785, 0.08)],
    [E, '#7fb4e8', box(0.56, 0.32, 0.005, 0, 1.03, -0.197)],
    [P, '#e8e2d2', box(0.21, 0.01, 0.3, 0.45, 0.78, 0.05)]
  ]
  for (const [arr, c, geo] of parts) arr.push([c, rotY(geo, yaw, x, z)])
}
function shelfUnit(P: Part[], x: number, z: number, len: number, yaw: number, r: () => number, h = 1.8) {
  const cols = ['#d8473a', '#f2c12e', '#2f8a5b', '#1f4fa0', '#e8732a', '#efe8d6', '#7a4a8a', '#3fa0c0', '#c8c03a']
  const parts: Part[] = [['#c9ccd1', box(len, 0.04, 0.5, 0, 0.12, 0)]]
  for (let k = 0; k < 4; k++) parts.push(['#c9ccd1', box(len, 0.03, 0.5, 0, 0.15 + k * 0.45, 0)])
  parts.push(['#8a8e96', box(len, h, 0.04, 0, h / 2, 0)])
  for (let k = 0; k < 4; k++) {
    for (let p = -len / 2 + 0.12; p < len / 2 - 0.1; p += 0.16 + r() * 0.08) {
      const hh = 0.14 + r() * 0.2
      const c = cols[Math.floor(r() * cols.length)]
      for (const side of [-1, 1]) parts.push([c, box(0.12, hh, 0.16, p, 0.17 + k * 0.45 + hh / 2, side * 0.13)])
    }
  }
  for (const [c, geo] of parts) P.push([c, rotY(geo, yaw, x, z)])
}
function tableSet(P: Part[], x: number, z: number, n: number, top = '#8a5a3a', cloth?: string): Array<[number, number, number]> {
  P.push([cloth ?? top, cyl(0.55, 0.55, 0.05, x, 0.75, z, 20)])
  P.push(['#3a2a1a', cyl(0.06, 0.06, 0.72, x, 0.37, z, 8)])
  const seats: Array<[number, number, number]> = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 4
    const cx = x + Math.sin(a) * 0.85
    const cz = z + Math.cos(a) * 0.85
    const yaw = Math.atan2(x - cx, z - cz)
    chair(P, cx, cz, yaw, '#6b4a2f')
    seats.push([cx, cz, yaw])
  }
  return seats
}
function plant(P: Part[], x: number, z: number) {
  P.push(['#8a5a3a', cyl(0.22, 0.17, 0.4, x, 0.2, z, 12)])
  for (let i = 0; i < 6; i++) P.push(['#3f7a3a', sph(0.24, x + Math.sin(i) * 0.12, 0.7 + (i % 3) * 0.18, z + Math.cos(i) * 0.12, 0.7, 1.4, 0.7)])
}
function counter(P: Part[], G: Part[], x: number, z: number, w: number, yaw: number, top = '#2a2d33', front = '#8a5a3a') {
  P.push([front, rotY(box(w, 1.0, 0.6, 0, 0.5, 0), yaw, x, z)])
  G.push([top, rotY(box(w + 0.1, 0.05, 0.7, 0, 1.03, 0), yaw, x, z)])
}

// --------------------------------------------------------------- venues
export function buildVenue(type: VenueType, seed: number): BuiltVenue {
  const [W, D] = VENUE_INFO[type].size
  const r = rng(seed + 11)
  const actors: VenueActor[] = []
  const spots: VenueSpot[] = []
  let nid = Math.floor(seed * 1000) % 100000
  const person = (x: number, z: number, yaw: number, mode: ActorMode, extra: Partial<VenueActor> = {}) =>
    actors.push({ id: nid++, x, z, yaw, mode, female: r() < 0.5, ...extra })
  const FACE_BACK = Math.PI // looking towards -Z
  let s: Shell

  switch (type) {
    // ------------------------------------------------------------ office
    case 'office': {
      s = shell(W, D, tileTex('#d8d4cc', '#a8a49a', 4, 'office-tile'), 2.4, '#e8ecef')
      // two rows of desks facing the back wall, workers typing
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 4; i++) {
          const x = -W / 2 + 2.4 + i * 2.2
          const z = -D / 2 + 2.2 + row * 3
          deskUnit(s.P, s.G, s.E, x, z, 0)
          chair(s.P, x, z + 0.75, FACE_BACK)
          s.colliders.push({ x, z, w: 1.45, d: 0.8 })
          if (r() < 0.8) person(x, z + 0.72, FACE_BACK, 'type', { seat: 0.47 })
          else spots.push({ id: 'office_desk', x: x + 0.6, z: z + 1.1, fx: x, fz: z, seat: { x, z: z + 0.72, h: 0.47, yaw: FACE_BACK }, act: { label: 'Free desk', button: 'Work at this desk', need: 'fun', gain: 6, dur: 8, pose: 'type', stay: true } })
        }
      }
      // meeting table on the right: a stand-up meeting
      const mx = W / 2 - 2.6
      const mz = -0.5
      s.P.push(['#e8e2d2', box(2.4, 0.05, 1.1, mx, 0.75, mz)])
      s.P.push(['#5a5e66', box(0.1, 0.72, 0.9, mx, 0.37, mz)])
      s.colliders.push({ x: mx, z: mz, w: 2.4, d: 1.1 })
      s.P.push(['#f4f4f2', box(0.04, 1.2, 2.2, W / 2 - 0.14, 1.6, mz)])
      for (const [dx, dz, yw] of [
        [-0.6, -0.9, 0],
        [0.6, -0.9, 0],
        [-0.6, 0.9, Math.PI],
        [0.7, 0.9, Math.PI]
      ])
        person(mx + dx, mz + dz, yw, 'talk')
      // reception + water cooler + plants
      counter(s.P, s.G, -W / 2 + 2.5, D / 2 - 2, 2.6, 0, '#e8e2d2', '#3f6a8a')
      s.colliders.push({ x: -W / 2 + 2.5, z: D / 2 - 2, w: 2.7, d: 0.7 })
      person(-W / 2 + 2.5, D / 2 - 2.6, 0, 'type', { staff: 'reception' })
      s.G.push(['#bfe0f0', cyl(0.15, 0.15, 0.4, W / 2 - 1, 1.3, D / 2 - 1.5, 12)])
      s.P.push(['#e8e8e6', box(0.35, 1.1, 0.35, W / 2 - 1, 0.55, D / 2 - 1.5)])
      spots.push({ id: 'office_cooler', x: W / 2 - 1.6, z: D / 2 - 1.5, fx: W / 2 - 1, fz: D / 2 - 1.5, act: { label: 'Water cooler', button: 'Chat by the cooler', need: 'social', gain: 30, dur: 6, pose: 'talk' } })
      person(W / 2 - 1.7, D / 2 - 2.3, Math.PI / 2, 'talk')
      plant(s.P, -W / 2 + 0.6, -D / 2 + 0.6)
      plant(s.P, W / 2 - 0.6, -D / 2 + 0.6)
      break
    }
    // ------------------------------------------------------------ supermarket
    case 'supermarket': {
      s = shell(W, D, tileTex('#f2f0ea', '#c8c4b8', 3, 'mart-tile'), 1.6, '#f4f2ee')
      for (let i = 0; i < 4; i++) {
        const x = -W / 2 + 2.6 + i * 2.8
        shelfUnit(s.P, x, -1.2, 5.2, Math.PI / 2, r)
        s.colliders.push({ x, z: -1.2, w: 0.6, d: 5.2 })
        // shoppers browsing either side of the aisle
        if (r() < 0.8) person(x + 0.75, -1.2 + (r() - 0.5) * 3, -Math.PI / 2, 'browse')
        if (r() < 0.5) person(x - 0.75, -1.2 + (r() - 0.5) * 3, Math.PI / 2, 'browse')
      }
      shelfUnit(s.P, 0, -D / 2 + 0.4, W - 1.6, 0, r, 2.2)
      // fridges along the left wall (glowing)
      for (let k = 0; k < 3; k++) s.E.push(['#dff2ff', box(0.05, 1.8, 1.4, -W / 2 + 0.25, 1.0, 1.6 + k * 1.5)])
      // checkout tills at the front
      for (const cx of [-2.5, 0.5, 3.5]) {
        counter(s.P, s.G, cx, D / 2 - 2.6, 1.8, 0, '#2a2d33', '#d8473a')
        s.colliders.push({ x: cx, z: D / 2 - 2.6, w: 1.9, d: 0.7 })
        person(cx + 0.3, D / 2 - 3.3, 0, 'serve', { staff: 'cashier' })
      }
      person(-1.5, D / 2 - 1.8, Math.PI, 'idle')
      spots.push({ id: 'mart_shop', x: 2.0, z: D / 2 - 1.9, fx: 3.5, fz: D / 2 - 2.6, act: { label: 'Checkout', button: 'Buy groceries · 300 ks', need: 'hunger', gain: 60, dur: 4, pose: 'browse', service: 'shop_groceries' } })
      break
    }
    // ------------------------------------------------------------ mall
    case 'mall': {
      s = shell(W, D, tileTex('#e8e4dc', '#b8b0a2', 2, 'mall-tile'), 3, '#efe9e0')
      const fronts = ['#d8473a', '#1f4fa0', '#2f8a5b', '#f2a03a', '#7a4a8a', '#2a2d33']
      // shopfronts along the back and sides (glowing signage)
      for (let i = 0; i < 5; i++) {
        const x = -W / 2 + 2.6 + i * 4.6
        s.P.push([fronts[i % fronts.length], box(4.0, 0.6, 0.3, x, 3.0, -D / 2 + 0.3)])
        s.E.push(['#fff2c0', box(3.2, 0.25, 0.05, x, 3.0, -D / 2 + 0.47)])
        shelfUnit(s.P, x, -D / 2 + 1.2, 3.2, 0, r, 1.4)
        person(x + (r() - 0.5) * 2, -D / 2 + 2.2, FACE_BACK, 'browse')
      }
      // fountain in the middle
      s.G.push(['#c8c4b8', cyl(2.0, 2.1, 0.5, 0, 0.25, -1, 32)])
      s.E.push(['#7fc4e8', cyl(1.85, 1.85, 0.05, 0, 0.48, -1, 32)])
      s.G.push(['#c8c4b8', cyl(0.25, 0.35, 1.4, 0, 0.7, -1, 16)])
      s.colliders.push({ x: 0, z: -1, w: 4.2, d: 4.2 })
      // food court tables with people eating and talking
      for (const [tx, tz] of [
        [-7, 3.5],
        [-3.8, 4.5],
        [3.8, 4.5],
        [7, 3.5]
      ]) {
        const seats = tableSet(s.P, tx, tz, 3, '#efe8d6')
        s.colliders.push({ x: tx, z: tz, w: 1.1, d: 1.1 })
        seats.forEach(([cx, cz, yaw], k) => {
          if (k < 2 || r() < 0.4) person(cx, cz, yaw, k === 0 ? 'eat' : r() < 0.5 ? 'talk' : 'drink', { seat: 0.47 })
        })
      }
      counter(s.P, s.G, W / 2 - 3, 3, 3, -Math.PI / 2, '#efe8d6', '#c84a3a')
      s.colliders.push({ x: W / 2 - 3, z: 3, w: 0.7, d: 3.1 })
      person(W / 2 - 2.3, 3, -Math.PI / 2, 'cook', { staff: 'chef' })
      spots.push({ id: 'mall_food', x: W / 2 - 4, z: 3, fx: W / 2 - 3, fz: 3, act: { label: 'Food court', button: 'Buy shawarma · 200 ks', need: 'hunger', gain: 55, dur: 5, pose: 'eat', service: 'mall_snack' } })
      // people walking the concourse
      for (let k = 0; k < 4; k++) person(-6 + k * 4, 1.2 + (k % 2), k % 2 ? Math.PI / 2 : -Math.PI / 2, 'talk')
      break
    }
    // ------------------------------------------------------------ gym
    case 'gym': {
      s = shell(W, D, concreteTex(), 2, '#3a3d44')
      // mirror wall
      s.G.push(['#b8d0dc', box(W - 2, 2.2, 0.04, 0, 1.4, -D / 2 + 0.14)])
      // treadmills facing the mirror, people running
      for (let i = 0; i < 4; i++) {
        const x = -W / 2 + 2 + i * 1.6
        const z = -D / 2 + 1.8
        s.P.push(['#1b1d22', box(0.8, 0.18, 1.8, x, 0.09, z)])
        s.P.push(['#2a2d33', box(0.08, 1.2, 0.08, x - 0.35, 0.7, z - 0.8)])
        s.P.push(['#2a2d33', box(0.08, 1.2, 0.08, x + 0.35, 0.7, z - 0.8)])
        s.E.push(['#4ad08a', box(0.5, 0.25, 0.05, x, 1.3, z - 0.82)])
        s.colliders.push({ x, z: z - 0.8, w: 0.85, d: 0.2 })
        if (i < 3) person(x, z + 0.1, FACE_BACK, 'run')
        else spots.push({ id: 'gym_run', x: x + 0.7, z: z + 0.5, fx: x, fz: z, act: { label: 'Treadmill', button: 'Run 20 minutes · 100 ks', need: 'fun', gain: 35, dur: 8, pose: 'run', service: 'gym_session' } })
      }
      // dumbbell rack + lifters
      const rx = W / 2 - 2.2
      s.P.push(['#2a2d33', box(0.6, 0.8, 3, rx, 0.4, -1)])
      for (let k = 0; k < 8; k++) s.G.push(['#8a8e96', cyl(0.07, 0.07, 0.3, rx, 0.85, -2.3 + k * 0.38, 10).rotateZ(Math.PI / 2).translate(0, 0, 0)])
      s.colliders.push({ x: rx, z: -1, w: 0.7, d: 3.1 })
      person(rx - 1.0, -1.8, Math.PI / 2, 'lift')
      person(rx - 1.0, 0.2, Math.PI / 2, 'lift')
      spots.push({ id: 'gym_lift', x: rx - 1.0, z: -0.8, fx: rx, fz: -0.8, act: { label: 'Dumbbells', button: 'Lift weights', need: 'fun', gain: 25, dur: 7, pose: 'lift' } })
      // benches + stretching mats
      for (const bx of [-3, 0]) {
        s.P.push(['#d8473a', box(0.4, 0.45, 1.4, bx, 0.25, 1.5)])
        s.colliders.push({ x: bx, z: 1.5, w: 0.45, d: 1.4 })
      }
      for (const mx of [-5.5, 3]) {
        s.P.push(['#2f8a5b', box(0.9, 0.02, 1.9, mx, 0.01, 3.4)])
        person(mx, 3.4, 0, 'kneel')
      }
      person(-1.5, 2.8, -Math.PI / 4, 'talk', { staff: 'trainer' })
      break
    }
    // ------------------------------------------------------------ mosque
    case 'mosque': {
      s = shell(W, D, carpetTex('#1f6a4a', '#d8b84a', 'prayer-carpet'), 3.2, '#f2efe6')
      // mihrab niche on the qibla (back) wall + minbar beside it
      s.P.push(['#d8b84a', box(1.8, 2.8, 0.25, 0, 1.4, -D / 2 + 0.2)])
      s.P.push(['#1f6a4a', box(1.3, 2.3, 0.1, 0, 1.2, -D / 2 + 0.36)])
      s.G.push(['#d8b84a', cyl(0.66, 0.66, 0.12, 0, 2.4, -D / 2 + 0.38, 20, ).rotateX(Math.PI / 2).translate(0, 0, 0)])
      for (let k = 0; k < 5; k++) s.P.push(['#8a5a3a', box(0.9, 0.22, 0.4, 1.8, 0.11 + k * 0.22, -D / 2 + 0.6 + k * 0.4)])
      s.colliders.push({ x: 1.8, z: -D / 2 + 1.4, w: 0.95, d: 2.1 })
      // chandelier + Quran stand
      s.E.push(['#ffe6a8', sph(0.4, 0, 3.0, 0)])
      s.P.push(['#8a5a3a', box(0.4, 0.5, 0.3, -2.2, 0.25, -D / 2 + 1.0)])
      // the imam leads, rows of worshippers behind him, all in sync
      person(0, -D / 2 + 1.6, FACE_BACK, 'pray', { sync: true, female: false })
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 7; i++) {
          if (row === 2 && i > 4) continue
          person(-3.6 + i * 1.2, -D / 2 + 3.2 + row * 1.6, FACE_BACK, 'pray', { sync: true, female: false })
        }
      }
      // a man reading Quran by the wall
      person(-W / 2 + 1.2, 2.5, Math.PI / 2, 'kneel', { female: false })
      spots.push({ id: 'mosque_pray', x: 3.6 + 1.2, z: -D / 2 + 3.2 + 1.6, fx: 3.6, fz: -D / 2, act: { label: 'Prayer row', button: 'Join the prayer', need: 'social', gain: 40, dur: 16, pose: 'pray' } })
      break
    }
    // ------------------------------------------------------------ church
    case 'church': {
      s = shell(W, D, woodTex(), 2.2, '#f2ede2')
      // altar, cross, pulpit, keyboard + drums
      s.P.push(['#efe8d6', box(W - 4, 0.4, 3, 0, 0.2, -D / 2 + 1.6)])
      s.colliders.push({ x: 0, z: -D / 2 + 1.6, w: W - 4, d: 3 })
      s.P.push(['#6b4a2f', box(0.25, 2.6, 0.12, 0, 2.4, -D / 2 + 0.2)])
      s.P.push(['#6b4a2f', box(1.4, 0.25, 0.12, 0, 2.95, -D / 2 + 0.2)])
      s.E.push(['#fff2c0', box(W - 6, 0.12, 0.04, 0, 3.25, -D / 2 + 0.14)])
      s.P.push(['#6b4a2f', box(0.9, 1.15, 0.6, 0, 0.98, -D / 2 + 2.6)])
      s.P.push(['#1b1d22', box(1.2, 0.08, 0.4, -3.5, 1.25, -D / 2 + 1.6)])
      s.G.push(['#c8c4b8', cyl(0.28, 0.28, 0.3, 3.4, 0.75, -D / 2 + 1.4, 16)])
      s.G.push(['#c8c4b8', cyl(0.22, 0.22, 0.25, 3.9, 0.75, -D / 2 + 1.9, 16)])
      // pastor preaching, choir singing
      person(0, -D / 2 + 2.15, 0, 'talk', { female: false, staff: 'pastor' })
      for (let i = 0; i < 4; i++) person(-5.6 + i * 0.9, -D / 2 + 1.2, 0, 'worship', { staff: 'choir' })
      person(-3.5, -D / 2 + 2.0, Math.PI, 'type')
      // pews in two blocks, congregation standing and worshipping
      for (let row = 0; row < 6; row++) {
        const z = -D / 2 + 5 + row * 1.6
        for (const bx of [-3.6, 3.6]) {
          s.P.push(['#6b4a2f', box(5, 0.08, 0.45, bx, 0.47, z)])
          s.P.push(['#6b4a2f', box(5, 0.6, 0.08, bx, 0.8, z + 0.24)])
          s.colliders.push({ x: bx, z: z + 0.1, w: 5, d: 0.6 })
          for (let k = 0; k < 4; k++) {
            if (r() < 0.65) {
              const px = bx - 1.9 + k * 1.25
              if (r() < 0.75) person(px, z - 0.4, FACE_BACK, 'worship')
              else person(px, z, FACE_BACK, 'sit', { seat: 0.47 })
            }
          }
        }
      }
      spots.push({ id: 'church_worship', x: 0, z: -D / 2 + 6.5, fx: 0, fz: -D / 2, act: { label: 'Service', button: 'Join the worship', need: 'social', gain: 40, dur: 10, pose: 'worship' } })
      break
    }
    // ------------------------------------------------------------ bar
    case 'bar': {
      s = shell(W, D, woodTex(), 1.8, '#2a2230', { dark: true, light: '#ff9ad0' })
      counter(s.P, s.G, -1, -D / 2 + 1.8, 6, 0, '#1b1d22', '#6b3a2a')
      s.colliders.push({ x: -1, z: -D / 2 + 1.8, w: 6.1, d: 0.7 })
      // bottle wall + neon
      s.P.push(['#3a2a20', box(6, 1.6, 0.3, -1, 1.7, -D / 2 + 0.2)])
      const bc = ['#3a8a4a', '#8a5a2a', '#c8c4b8', '#2a4a8a', '#8a2a2a']
      for (let k = 0; k < 22; k++) s.G.push([bc[k % bc.length], cyl(0.05, 0.05, 0.3, -3.8 + k * 0.26, 1.35 + (k % 2) * 0.5, -D / 2 + 0.3, 8)])
      s.E.push(['#ff4ab0', box(4, 0.08, 0.05, -1, 2.8, -D / 2 + 0.14)])
      s.E.push(['#4ad0ff', box(0.08, 2.2, 0.05, -W / 2 + 0.14, 1.6, -1)])
      person(-1.5, -D / 2 + 1.0, 0, 'serve', { staff: 'bartender' })
      // stools with drinkers
      for (let i = 0; i < 6; i++) {
        const x = -3.6 + i * 1.0
        s.P.push(['#1b1d22', cyl(0.2, 0.2, 0.06, x, 0.75, -D / 2 + 2.6, 12)])
        s.P.push(['#8a8e96', cyl(0.03, 0.03, 0.75, x, 0.37, -D / 2 + 2.6, 6)])
        if (i !== 4 && r() < 0.75) person(x, -D / 2 + 2.6, FACE_BACK, 'drink', { seat: 0.75 })
        if (i === 4) spots.push({ id: 'bar_drink', x, z: -D / 2 + 3.4, fx: x, fz: -D / 2 + 1.8, seat: { x, z: -D / 2 + 2.6, h: 0.75, yaw: FACE_BACK }, act: { label: 'Bar stool', button: 'Order a drink · 150 ks', need: 'fun', gain: 40, dur: 7, pose: 'drink', service: 'bar_drink', stay: true } })
      }
      // dance floor + speakers
      s.E.push(['#5a2a7a', box(4, 0.01, 3.6, W / 2 - 3, 0.012, 2)])
      for (const sx of [W / 2 - 0.6, W / 2 - 5.4]) s.P.push(['#1b1d22', box(0.6, 1.4, 0.5, sx, 0.7, 3.8)])
      for (let k = 0; k < 5; k++) person(W / 2 - 4.3 + (k % 3) * 1.1, 1.2 + Math.floor(k / 3) * 1.4, r() * 6, 'dance')
      spots.push({ id: 'bar_dance', x: W / 2 - 2.5, z: 2.8, fx: W / 2 - 3, fz: 2, act: { label: 'Dance floor', button: 'Dance', need: 'fun', gain: 50, dur: 8, pose: 'dance', social: 1 } })
      // lounge tables
      for (const [tx, tz] of [
        [-4.5, 2.6],
        [-1.8, 3.4]
      ]) {
        const seats = tableSet(s.P, tx, tz, 3, '#1b1d22')
        s.colliders.push({ x: tx, z: tz, w: 1.1, d: 1.1 })
        seats.forEach(([cx, cz, yaw], k) => k < 2 && person(cx, cz, yaw, k ? 'talk' : 'drink', { seat: 0.47 }))
      }
      break
    }
    // ------------------------------------------------------------ restaurant
    case 'restaurant': {
      s = shell(W, D, tileTex('#d8c0a0', '#a08a6a', 4, 'resto-tile'), 2, '#f2e2c8')
      // open kitchen pass at the back with a cook
      counter(s.P, s.G, 0, -D / 2 + 1.5, 7, 0, '#c8ccd2', '#8a5a3a')
      s.colliders.push({ x: 0, z: -D / 2 + 1.5, w: 7.1, d: 0.7 })
      s.G.push(['#8a8e96', box(2, 0.1, 0.6, -2, 1.1, -D / 2 + 0.6)])
      s.E.push(['#ff7a2a', box(1.6, 0.02, 0.4, -2, 1.16, -D / 2 + 0.6)])
      person(-2, -D / 2 + 0.95, Math.PI, 'cook', { staff: 'chef' })
      person(1.5, -D / 2 + 0.95, Math.PI, 'cook', { staff: 'chef' })
      // dining tables: families and friends eating
      const tables: Array<[number, number]> = [
        [-4, 0.5],
        [0, 0.5],
        [4, 0.5],
        [-4, 3.5],
        [4, 3.5]
      ]
      for (const [tx, tz] of tables) {
        const seats = tableSet(s.P, tx, tz, 4, '#efe8d6', ['#d8473a', '#2f8a5b', '#efe8d6'][Math.floor(r() * 3)])
        s.colliders.push({ x: tx, z: tz, w: 1.1, d: 1.1 })
        s.G.push(['#f8f8f6', cyl(0.14, 0.12, 0.03, tx - 0.2, 0.79, tz, 14)])
        s.G.push(['#f8f8f6', cyl(0.14, 0.12, 0.03, tx + 0.2, 0.79, tz + 0.1, 14)])
        seats.forEach(([cx, cz, yaw], k) => {
          if (r() < 0.7) person(cx, cz, yaw, k % 2 ? 'eat' : 'talk', { seat: 0.47 })
        })
      }
      person(1.8, 2.2, 0.5, 'serve', { staff: 'waiter' })
      const seats = tableSet(s.P, 0, 3.8, 2, '#efe8d6', '#3f6fae')
      s.colliders.push({ x: 0, z: 3.8, w: 1.1, d: 1.1 })
      const [sx2, sz2, syaw] = seats[0]
      spots.push({ id: 'resto_eat', x: sx2 + 0.6, z: sz2 + 0.6, fx: 0, fz: 3.8, seat: { x: sx2, z: sz2, h: 0.47, yaw: syaw }, act: { label: 'Free table', button: 'Order jollof · 350 ks', need: 'hunger', gain: 80, dur: 8, pose: 'eat', service: 'restaurant_meal', stay: true } })
      break
    }
    // ------------------------------------------------------------ hotel
    case 'hotel': {
      s = shell(W, D, tileTex('#e8e0d0', '#b8a888', 2, 'hotel-tile'), 2.6, '#efe6d6')
      counter(s.P, s.G, -3, -D / 2 + 2, 4, 0, '#2a2d33', '#6b4a2f')
      s.colliders.push({ x: -3, z: -D / 2 + 2, w: 4.1, d: 0.7 })
      s.E.push(['#ffe6a8', box(3, 0.4, 0.05, -3, 2.5, -D / 2 + 0.14)])
      person(-3.6, -D / 2 + 1.3, 0, 'serve', { staff: 'reception' })
      person(-2.2, -D / 2 + 1.3, 0, 'type', { staff: 'reception' })
      person(-3, -D / 2 + 2.9, Math.PI, 'talk')
      // lobby lounge: sofas, guests reading / on their phones
      const sofa = (x: number, z: number, yaw: number) => {
        s.P.push(['#4a5a72', rotY(rbox(2.0, 0.42, 0.85, 0, 0.21, 0), yaw, x, z)])
        s.P.push(['#4a5a72', rotY(rbox(2.0, 0.5, 0.2, 0, 0.6, -0.35), yaw, x, z)])
        s.colliders.push({ x, z, w: Math.abs(Math.sin(yaw)) > 0.5 ? 0.9 : 2.0, d: Math.abs(Math.sin(yaw)) > 0.5 ? 2.0 : 0.9 })
      }
      sofa(2.5, 0.5, 0)
      sofa(2.5, 3.2, Math.PI)
      s.P.push(['#8a5a3a', box(1.2, 0.4, 0.7, 2.5, 0.2, 1.85)])
      person(2.0, 0.6, 0, 'read', { seat: 0.44 })
      person(3.0, 3.1, Math.PI, 'read', { seat: 0.44 })
      plant(s.P, W / 2 - 0.7, -D / 2 + 0.7)
      plant(s.P, -W / 2 + 0.7, D / 2 - 0.9)
      // a guest room behind a partition with a made bed
      const bx = W / 2 - 2.5
      const bz = -D / 2 + 2.2
      s.P.push(['#efe8d6', rbox(2.0, 0.5, 2.2, bx, 0.25, bz)])
      s.P.push(['#7a3a4a', box(2.02, 0.08, 1.4, bx, 0.52, bz + 0.35)])
      s.P.push(['#6b4a2f', box(2.2, 1.1, 0.12, bx, 0.55, bz - 1.15)])
      s.colliders.push({ x: bx, z: bz, w: 2.1, d: 2.3 })
      spots.push({ id: 'hotel_sleep', x: bx - 1.6, z: bz + 0.4, fx: bx, fz: bz, seat: { x: bx, z: bz + 0.1, h: 0.52, yaw: 0 }, act: { label: 'Hotel room', button: 'Book a night · 1,500 ks', need: 'energy', gain: 100, dur: 8, pose: 'sleep', service: 'hotel_night' } })
      // porter with luggage near the door
      s.P.push(['#2a4a8a', box(0.45, 0.6, 0.25, -W / 2 + 2.5, 0.3, D / 2 - 2)])
      person(-W / 2 + 2, D / 2 - 2.3, 0.6, 'idle', { staff: 'porter' })
      break
    }
    // ------------------------------------------------------------ cinema
    case 'cinema': {
      s = shell(W, D, carpetTex('#5a1a2a', '#3a0a1a', 'cine-carpet'), 2, '#1d1a22', { dark: true, light: '#ffb070', windows: false })
      // screen on the back wall (glows) + tiered rows
      const film = filmTex()
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(W - 3, (W - 3) * 0.42), new THREE.MeshBasicMaterial({ map: film }))
      scr.position.set(0, 2.0, -D / 2 + 0.16)
      s.group.add(scr)
      s.disposables.push(scr.geometry, scr.material as THREE.Material)
      for (let row = 0; row < 5; row++) {
        const z = -D / 2 + 5 + row * 1.6
        const y = row * 0.28
        s.P.push(['#2a1a20', box(W - 2, y + 0.01, 1.6, 0, y / 2, z + 0.2)])
        for (let k = 0; k < 9; k++) {
          const x = -W / 2 + 2 + k * 1.5
          s.P.push(['#8a1a2a', box(0.6, 0.12, 0.55, x, y + 0.45, z)])
          s.P.push(['#8a1a2a', box(0.6, 0.6, 0.1, x, y + 0.75, z + 0.3)])
          if (row === 2 && k === 4) {
            spots.push({ id: 'cine_watch', x: x + 0.75, z: z + 0.2, fx: x, fz: -D / 2, seat: { x, z, h: y + 0.48, yaw: FACE_BACK }, act: { label: 'Cinema seat', button: 'Watch the film · 250 ks', need: 'fun', gain: 70, dur: 12, pose: 'watch', service: 'cinema_ticket', stay: true } })
          } else if (r() < 0.55) person(x, z, FACE_BACK, r() < 0.2 ? 'drink' : 'watch', { seat: y + 0.48 })
        }
        s.colliders.push({ x: 0, z: z + 0.3, w: W - 3.5, d: 0.2 })
      }
      // concession stand by the door
      counter(s.P, s.G, W / 2 - 2.5, D / 2 - 2, 3, 0, '#2a2d33', '#d8a23c')
      s.E.push(['#fff2c0', box(2.6, 0.3, 0.05, W / 2 - 2.5, 2.6, D / 2 - 2.8)])
      s.colliders.push({ x: W / 2 - 2.5, z: D / 2 - 2, w: 3.1, d: 0.7 })
      person(W / 2 - 2.5, D / 2 - 2.7, 0, 'serve', { staff: 'cashier' })
      break
    }
  }
  const room = finish(s!)
  return { room, actors, spots, W, D }
}

/** Which venue type a shop-front placement becomes (deterministic). */
export const VENUE_CYCLE: VenueType[] = ['restaurant', 'supermarket', 'mosque', 'bar', 'office', 'church', 'gym', 'hotel', 'cinema', 'mall']
void ankaraTex
void screenTex
