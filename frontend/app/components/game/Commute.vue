<script setup lang="ts">
// Commute - an automatic car ride to work or home (Lagos Life style).
//
// window 'kk-commute' {dest:'work'|'home'} starts it: an A* route over the
// road graph, a cab that drives it at city speed, the camera on a chase /
// side / top view. Positions stream to the server like any other move (well
// inside the speed envelope). "Skip ride" asks the SERVER to fast-travel
// (it only allows known destinations, see ws.py commute.skip); "Turn back"
// drives back the way you came.
import * as THREE from 'three'
import { vehicleMaterial, vehicleSpec } from '~/utils/vehicles'
import { findRoute, pathLength } from '~/utils/roadGraph'
import { useWorkStore } from '~/stores/work'
import { useCamOrbit, useInterior, useRide, fireKkEvent } from '~/composables/useControlsState'

const work = useWorkStore()
const ui = useUiStore()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const homeDoor = useState<[number, number] | null>('kk_home_door', () => null)
const socketSend = useState<((t: string, p: Record<string, unknown>) => void) | null>('kk_socket_send', () => null)
const orbit = useCamOrbit()
const interior = useInterior()
const ride = useRide()

const CRUISE = 15 // m/s ~ 54 km/h in town
const spec = vehicleSpec('car')
const mat = vehicleMaterial({ color: '#e8b83a' }) // Kaduna yellow cab
const cab = new THREE.Mesh(spec.geoRider, mat)
cab.castShadow = true
cab.visible = false

let path: [number, number][] = []
let cum: number[] = []
let total = 0
let s = 0
let v = 0
let lastSend = 0
let waitingSkip = false
let travelled: [number, number][] = []

const LINES = {
  work: ['Out of the house. Straight to work.', 'Traffic is moving small small.', 'Okada just cut in front. Typical.', 'Almost there. {name} is just ahead.'],
  home: ['Shift done. Heading home.', 'Suya smoke on every corner.', 'Generator noise everywhere tonight.', 'Home stretch.'],
  place: ['On the way to {name}.', 'Traffic is moving small small.', 'Keke driver waving you through.', 'Almost there. {name} is just ahead.'],
  back: ['Turning back. No wahala.', 'Back the way we came.', 'Almost back.', 'Almost back.']
}

function setPath(p: [number, number][]) {
  path = p
  cum = [0]
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]))
  total = cum[cum.length - 1] || 1
  s = 0
}
function at(dist: number): { x: number; z: number; h: number } {
  let i = 1
  while (i < cum.length - 1 && cum[i] < dist) i++
  const a = path[i - 1]
  const b = path[i]
  const seg = cum[i] - cum[i - 1] || 1
  const t = Math.min(1, Math.max(0, (dist - cum[i - 1]) / seg))
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[0] - a[0], b[1] - a[1]) }
}

function start(dest: 'work' | 'home' | 'place', place?: { code?: string; name: string; to: [number, number] }) {
  if (work.commute?.active) return
  if (ride.value.active) return ui.showToast('Get out of the vehicle first.', 'info')
  if (interior.value.inside) return ui.showToast('Step outside first, then go.', 'info')
  let to: [number, number] | null = null
  let code = ''
  let name = ''
  if (dest === 'work') {
    const c = work.career
    if (!c) return ui.showToast('Pick a job first: Phone → Work.', 'info')
    to = [c.position[0] + 4, c.position[2] + 4]
    code = c.place_code
    name = c.place_name
  } else if (dest === 'place' && place) {
    to = place.to
    code = place.code ?? '' // no code (e.g. a hospital) = drive only, no skip
    name = place.name
  } else {
    if (!homeDoor.value) return ui.showToast("Can't find your home.", 'error')
    to = [homeDoor.value[0], homeDoor.value[1]]
    code = 'home'
    name = 'Home'
  }
  const from: [number, number] = [playerPos.value[0], playerPos.value[2]]
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 25) {
    // already there: no taxi needed
    return arrive(dest, false)
  }
  setPath(findRoute(from, to))
  travelled = [from]
  v = 0
  cab.visible = true
  work.commute = {
    active: true,
    dest,
    code,
    name,
    to,
    from,
    vehicle: 'Kaduna cab',
    progress: 0,
    eta: total / CRUISE,
    msg: LINES[dest][0].replace('{name}', name),
    view: 'chase',
    returning: false
  }
  orbit.value.dist = 12
  orbit.value.pitch = 0.38
  socketSend.value?.('commute.start', { dest: code })
}

function turnBack() {
  const c = work.commute
  if (!c?.active || c.returning) return
  const here = at(s)
  // drive back over the road we already covered
  const back: [number, number][] = [[here.x, here.z], ...travelled.slice().reverse()]
  setPath(back)
  c.returning = true
  c.msg = LINES.back[0]
  c.name = 'where you started'
}

function skip() {
  const c = work.commute
  if (!c?.active || waitingSkip) return
  if (c.returning || !c.code) {
    // the server only fast-travels to known places; finish the drive instead
    s = Math.max(s, total - 1)
    return
  }
  waitingSkip = true
  socketSend.value?.('commute.skip', { dest: c.code, home: c.code === 'home' ? c.to : undefined })
  // if the server refuses, keep driving
  setTimeout(() => (waitingSkip = false), 4000)
}

function onArrived(e: Event) {
  const pos = (e as CustomEvent).detail as [number, number, number]
  const c = work.commute
  if (!c?.active) return
  playerPos.value = [pos[0], 0, pos[2]]
  waitingSkip = false
  arrive(c.dest, true)
}

async function arrive(dest: 'work' | 'home' | 'place', viaSkip: boolean) {
  const c = work.commute
  const returning = c?.returning
  cab.visible = false
  work.commute = null
  orbit.value.dist = 8.5
  orbit.value.pitch = 0.32
  if (!viaSkip) socketSend.value?.('commute.end', {})
  if (returning) return
  if (dest === 'work') {
    try {
      await work.clockIn()
      ui.showToast(`Clocked in as ${work.shift?.title}. Stay till the end to get paid.`, 'success')
    } catch (e: any) {
      ui.showToast(e.message || 'Could not clock in', 'error')
    }
  } else if (dest === 'home') {
    fireKkEvent('kk-go-home')
  } else {
    ui.showToast(`You've arrived at ${c?.name}.`, 'success')
  }
}

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  const c = work.commute
  if (!c?.active || waitingSkip) return
  const dt = Math.min(delta || 0.016, 0.25)
  const left = total - s
  const target = left < 40 ? Math.max(3, left * 0.35) : CRUISE
  v += Math.max(-6 * dt, Math.min(3 * dt, target - v))
  s = Math.min(total, s + v * dt)
  const p = at(s)
  cab.position.set(p.x, 0, p.z)
  // ease the heading so corners don't snap
  let dh = p.h - cab.rotation.y
  dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  cab.rotation.y += dh * Math.min(1, dt * 6)
  playerPos.value = [p.x, 0, p.z]
  const last = travelled[travelled.length - 1]
  if (!c.returning && Math.hypot(p.x - last[0], p.z - last[1]) > 8) travelled.push([p.x, p.z])

  // camera: chase sits behind, side looks across, top looks down
  const h = cab.rotation.y
  const want = c.view === 'side' ? h + Math.PI / 2 : h + Math.PI
  let dy = want - orbit.value.yaw
  dy = Math.atan2(Math.sin(dy), Math.cos(dy))
  orbit.value.yaw += dy * Math.min(1, dt * 2.5)
  orbit.value.pitch = c.view === 'top' ? 1.05 : 0.38
  orbit.value.dist = c.view === 'top' ? 30 : 12

  c.progress = s / total
  c.eta = Math.max(0, (total - s) / CRUISE)
  const lines = c.returning ? LINES.back : LINES[c.dest]
  c.msg = lines[Math.min(lines.length - 1, Math.floor(c.progress * lines.length))].replace('{name}', c.name)

  const now = performance.now()
  if (now - lastSend > 110) {
    lastSend = now
    socketSend.value?.('player.move', { position: [p.x, 0, p.z], facing: h })
  }
  if (s >= total - 0.5) arrive(c.dest, false)
})

const onStart = (e: Event) => {
  const d = (e as CustomEvent).detail ?? {}
  start((d.dest ?? 'work') as 'work' | 'home' | 'place', d.place)
}
onMounted(() => {
  window.addEventListener('kk-commute', onStart)
  window.addEventListener('kk-commute-skip', skip)
  window.addEventListener('kk-commute-back', turnBack)
  window.addEventListener('kk-commute-arrived', onArrived)
  if (import.meta.dev) (window as any).__kk_commute = () => ({ active: !!work.commute, s, total, nodes: path.length })
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-commute', onStart)
  window.removeEventListener('kk-commute-skip', skip)
  window.removeEventListener('kk-commute-back', turnBack)
  window.removeEventListener('kk-commute-arrived', onArrived)
})
</script>

<template>
  <primitive :object="cab" />
</template>
