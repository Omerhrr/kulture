<script setup lang="ts">
// RaceSystem - street races on real Kaduna roads. Phone → Races picks a
// route; you're driven to the start line, your car is waiting, and once you
// get in a 3-2-1 countdown starts. Glowing checkpoint gates mark the road,
// three AI racers (plus any live players nearby) race you, and the finish
// time goes to the server leaderboard. Kachia Road also hosts a night meet:
// after dark the racers idle at the start line with their underglow on.
import * as THREE from 'three'
import { raceRoutes, type RaceRoute, type RaceState } from '~/utils/raceRoutes'
import { ridePose } from '~/utils/rideState'
import { vehicleMaterial, vehicleSpec } from '~/utils/vehicles'
import { heightAt } from '~/utils/terrain'
import { useClock } from '~/composables/useTimeOfDay'
import { useRide } from '~/composables/useControlsState'

const race = useState<RaceState>('kk_race', () => ({ phase: 'idle', route: null, name: '', cp: 0, total: 0, startAt: 0, ms: 0, position: 1, result: null }))
const playerPos = useState<[number, number, number]>('kk_player_pos')
const ride = useRide()
const hour = useClock()
const ui = useUiStore()
const api = useGameApi()
const carTier = useState<number>('kk_car_tier', () => 0)

const root = new THREE.Group()
let route: RaceRoute | null = null

// ---- checkpoint gates (two posts + a glowing banner)
const gateMat = new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.85 })
const nextMat = new THREE.MeshBasicMaterial({ color: '#22e07a', transparent: true, opacity: 0.9 })
const finishMat = new THREE.MeshBasicMaterial({ color: '#ffffff' })
const gates: THREE.Group[] = []
function buildGate(x: number, z: number, heading: number, finish: boolean) {
  const g = new THREE.Group()
  const post = new THREE.CylinderGeometry(0.25, 0.25, 6, 8)
  const beam = new THREE.BoxGeometry(18, 1.1, 0.3)
  const m = finish ? finishMat : gateMat
  const l = new THREE.Mesh(post, m)
  l.position.set(-9, 3, 0)
  const r = new THREE.Mesh(post, m)
  r.position.set(9, 3, 0)
  const b = new THREE.Mesh(beam, m)
  b.position.set(0, 6, 0)
  g.add(l, r, b)
  g.position.set(x, heightAt(x, z), z)
  g.rotation.y = heading + Math.PI / 2
  root.add(g)
  gates.push(g)
}
function clearGates() {
  for (const g of gates) root.remove(g)
  gates.length = 0
}

// ---- AI racers
const PAINTS = ['#c81d25', '#f5c400', '#1aa34a', '#7a2bd6']
const NAMES = ['Sani "Speed" Bello', 'Chuks Turbo', 'Halima Drift', 'Kabiru V8']
interface Rival { mesh: THREE.Group; name: string; d: number; v: number; done: number }
const rivals: Rival[] = []
function carMesh(paint: string) {
  const spec = vehicleSpec('car')
  const geo = spec.geo.clone()
  const base = spec.geo.attributes.color.array as Float32Array
  const gloss = spec.geo.attributes.aGloss?.array as Float32Array | undefined
  const c = new THREE.Color(paint)
  const arr = new Float32Array(base.length)
  for (let i = 0; i < base.length / 3; i++) {
    const p = !gloss || Math.abs(gloss[i]! - 0.7) <= 0.01
    arr[i * 3] = base[i * 3]! * (p ? c.r : 1)
    arr[i * 3 + 1] = base[i * 3 + 1]! * (p ? c.g : 1)
    arr[i * 3 + 2] = base[i * 3 + 2]! * (p ? c.b : 1)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  const g = new THREE.Group()
  const body = new THREE.Mesh(geo, vehicleMaterial())
  body.castShadow = true
  g.add(body)
  if (spec.door) {
    const d = new THREE.Mesh(spec.door.geo, vehicleMaterial())
    const pv = new THREE.Group()
    pv.position.set(...spec.door.hinge)
    pv.add(d)
    g.add(pv)
  }
  // underglow for the night meet
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.6), new THREE.MeshBasicMaterial({ color: paint, transparent: true, opacity: 0.55 }))
  glow.rotation.x = -Math.PI / 2
  glow.position.y = 0.05
  glow.name = 'glow'
  g.add(glow)
  return g
}
for (let i = 0; i < 3; i++) {
  const mesh = carMesh(PAINTS[i]!)
  mesh.visible = false
  root.add(mesh)
  rivals.push({ mesh, name: NAMES[i]!, d: 0, v: 0, done: 0 })
}

// distance along route → point + heading
const segLen: number[] = []
function prep(r: RaceRoute) {
  segLen.length = 0
  for (let i = 1; i < r.cps.length; i++) segLen.push(Math.hypot(r.cps[i]![0] - r.cps[i - 1]![0], r.cps[i]![1] - r.cps[i - 1]![1]))
}
function along(d: number, lane: number): [number, number, number] {
  const r = route!
  let i = 0
  while (i < segLen.length - 1 && d > segLen[i]!) d -= segLen[i++]!
  const a = r.cps[i]!
  const b = r.cps[i + 1]!
  const t = Math.min(1, d / segLen[i]!)
  const h = Math.atan2(b[0] - a[0], b[1] - a[1])
  // lane offset to the right of travel direction
  const ox = Math.cos(h) * lane
  const oz = -Math.sin(h) * lane
  return [a[0] + (b[0] - a[0]) * t + ox, a[1] + (b[1] - a[1]) * t + oz, h]
}
function placeRivalsAtStart() {
  rivals.forEach((rv, i) => {
    const [x, z, h] = along(4 + i * 7, i % 2 ? -3.2 : 3.2)
    rv.mesh.position.set(x, heightAt(x, z), z)
    rv.mesh.rotation.y = h
    rv.mesh.visible = true
    rv.d = 4 + i * 7
    rv.v = 0
    rv.done = 0
  })
}

// ---- flow
function start(e: Event) {
  const id = (e as CustomEvent).detail?.route as string
  const r = raceRoutes().find((x) => x.id === id)
  if (!r) return ui.showToast('Route not found', 'error')
  if (race.value.phase === 'racing' || race.value.phase === 'countdown') return
  route = r
  prep(r)
  clearGates()
  r.cps.forEach((p, i) => {
    const q = r.cps[Math.min(i + 1, r.cps.length - 1)]!
    const pr = r.cps[Math.max(i - 1, 0)]!
    buildGate(p[0], p[1], Math.atan2(q[0] - pr[0], q[1] - pr[1]), i === r.cps.length - 1)
  })
  race.value = { phase: 'travel', route: r.id, name: r.name, cp: 1, total: r.cps.length - 1, startAt: 0, ms: 0, position: 1, result: null, live: [] }
  placeRivalsAtStart()
  lobby = null
  send('race.join', { route: r.id })
  const [sx, sz] = r.cps[0]!
  if (Math.hypot(playerPos.value[0] - sx, playerPos.value[2] - sz) > 60) {
    window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'place', place: { name: `${r.name} start line`, to: [sx + 6, sz + 6] } } }))
    ui.showToast(`Heading to the start of ${r.name}…`, 'info')
  }
}
function cancel() {
  send('race.leave', {})
  lobby = null
  race.value = { ...race.value, phase: 'idle', route: null }
  clearGates()
  for (const rv of rivals) rv.mesh.visible = false
  route = null
}
// ---- live multiplayer: same-route racers share one start and see each
// other's checkpoints (server race hub over the game socket)
const socketSend = useState<((type: string, payload: Record<string, unknown>) => boolean) | null>('kk_socket_send', () => null)
const send = (t: string, p: Record<string, unknown>) => {
  try {
    socketSend.value?.(t, p)
  } catch {}
}
let lobby: { start_at: number; offset: number; players: any[] } | null = null
let myId = ''
function onWs(e: Event) {
  const d = (e as CustomEvent).detail
  if (d?.type !== 'race.lobby' || d.payload.route !== race.value.route) return
  const pl = d.payload
  // server clock -> performance.now() clock
  lobby = { start_at: pl.start_at, offset: performance.now() - pl.server_now * 1000, players: pl.players }
  if (!myId) myId = (usePlayerStore().profile?.id as string) || ''
  race.value.live = pl.players.filter((p: any) => p.name && p.id !== myId).map((p: any) => ({ name: p.name, cp: p.cp, ms: p.ms, finished: p.finished, ready: p.ready }))
  // live standing even before you've set off (others may already be racing)
  if (race.value.phase !== 'done') race.value.position = 1 + race.value.live!.filter((p) => p.finished || p.cp > race.value.cp).length
  if (pl.start_at && (race.value.phase === 'countdown' || race.value.phase === 'board')) {
    const at = pl.start_at * 1000 + lobby.offset
    if (race.value.phase === 'countdown' && at > performance.now()) race.value.startAt = at
  }
}
onMounted(() => {
  window.addEventListener('kk-ws', onWs)
  window.addEventListener('kk-race', start)
  window.addEventListener('kk-race-cancel', cancel)
  // load your car tier so your car is painted/boosted from the start
  api.apiGet<any>('/life/status').then((s) => (carTier.value = s.car_tier)).catch(() => {})
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-ws', onWs)
  window.removeEventListener('kk-race', start)
  window.removeEventListener('kk-race-cancel', cancel)
})

async function finish() {
  const ms = Math.round(performance.now() - race.value.startAt)
  const position = 1 + rivals.filter((r) => r.done && r.done < performance.now()).length
  const humansAhead = (race.value.live ?? []).filter((p: any) => p.finished && p.ms < ms).length
  race.value = { ...race.value, phase: 'done', ms, position: position + humansAhead }
  send('race.finish', { ms })
  try {
    race.value.result = await api.apiPost<any>('/races/time', { route: race.value.route, ms, position })
  } catch (e: any) {
    race.value.result = { error: e.message }
  }
}

let last = performance.now()
const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  const night = hour.value >= 19 || hour.value < 5
  for (const rv of rivals) {
    const glow = rv.mesh.getObjectByName('glow')
    if (glow) glow.visible = night
  }
  // night meet: the Kachia Road crew idles at the start line after dark
  if (race.value.phase === 'idle') {
    const nightRoute = raceRoutes().find((r) => r.night)
    if (night && nightRoute && !route) {
      route = nightRoute
      prep(nightRoute)
      placeRivalsAtStart()
      route = null
    } else if (!night && rivals[0]!.mesh.visible) {
      for (const rv of rivals) rv.mesh.visible = false
    }
    return
  }
  if (!route) return
  const ph = race.value.phase
  const me: [number, number] = ridePose.active ? [ridePose.x, ridePose.z] : [playerPos.value[0], playerPos.value[2]]
  // gate colours: next one green
  gates.forEach((g, i) => {
    const m = i === race.value.cp ? nextMat : i === gates.length - 1 ? finishMat : gateMat
    g.children.forEach((c) => ((c as THREE.Mesh).material = m))
    g.visible = ph === 'racing' || ph === 'countdown' ? i >= race.value.cp - 1 && i <= race.value.cp + 3 : i <= 2
  })
  if (ph === 'travel') {
    const [sx, sz] = route.cps[0]!
    if (Math.hypot(me[0] - sx, me[1] - sz) < 45) {
      // your car is waiting on the grid
      // park it right beside you, nose pointing down the route
      const [, , h] = along(0, 0)
      window.dispatchEvent(new CustomEvent('kk-summon-car', { detail: { x: me[0] + Math.cos(h) * 2.4, z: me[1] - Math.sin(h) * 2.4, heading: h } }))
      race.value.phase = 'board'
      ui.showToast('Your car is on the grid. Get in to start!', 'info')
    }
  } else if (ph === 'board') {
    if (ride.value.active && ride.value.kind === 'car') {
      race.value.phase = 'countdown'
      send('race.ready', {})
      // shared start when the server lobby answers (others get a few
      // seconds to line up); solo fallback after 3 s if offline
      const shared = lobby?.start_at ? lobby.start_at * 1000 + lobby.offset : 0
      // join the shared start if it's still ahead; a heat already under way
      // is raced against the clock (their progress still shows live)
      race.value.startAt = shared > now ? shared : now + 3000
    }
  } else if (ph === 'countdown') {
    if (now >= race.value.startAt) {
      race.value.phase = 'racing'
      rivals.forEach((rv, i) => (rv.v = 24 + i * 2 + Math.random() * 3))
    }
  } else if (ph === 'racing') {
    race.value.ms = now - race.value.startAt
    const cp = route.cps[race.value.cp]!
    if (Math.hypot(me[0] - cp[0], me[1] - cp[1]) < 14) {
      race.value.cp++
      send('race.progress', { cp: race.value.cp, ms: Math.round(race.value.ms) })
      if (race.value.cp >= route.cps.length) finish()
    }
    // rivals drive the route, a little rubber-banding to keep it close
    const total = segLen.reduce((a, b) => a + b, 0)
    const myD = segLen.slice(0, race.value.cp - 1).reduce((a, b) => a + b, 0)
    rivals.forEach((rv, i) => {
      if (rv.done) return
      const gap = rv.d - myD
      const target = (24 + i * 2.5) * (gap > 120 ? 0.85 : gap < -120 ? 1.15 : 1) * (1 + 0.04 * Math.sin(now / 900 + i))
      rv.v += (target - rv.v) * Math.min(1, dt * 0.8)
      rv.d += rv.v * dt
      if (rv.d >= total) {
        rv.d = total
        rv.done = now
      }
      const [x, z, h] = along(rv.d, i % 2 ? -3.2 : 3.2)
      rv.mesh.position.set(x, heightAt(x, z), z)
      rv.mesh.rotation.y = h
    })
    const liveAhead = (race.value.live ?? []).filter((p: any) => p.finished || p.cp > race.value.cp).length
    race.value.position = 1 + rivals.filter((r) => r.d > myD + 20 || r.done).length + liveAhead
  }
})

if (import.meta.dev && typeof window !== 'undefined') {
  // headless check of a whole lap: tick through every checkpoint
  ;(window as any).__kk_race_autolap = async () => {
    while (race.value.phase === 'racing' && route) {
      race.value.ms = performance.now() - race.value.startAt
      race.value.cp++
      send('race.progress', { cp: race.value.cp, ms: Math.round(race.value.ms) })
      if (race.value.cp >= route.cps.length) {
        await finish()
        break
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    return race.value
  }
  ;(window as any).__kk_race = () => ({ ...race.value, routes: raceRoutes().map((r) => [r.id, r.cps.length, Math.round(r.length), r.cps[0]]) })
}
</script>

<template>
  <primitive :object="root" />
</template>
