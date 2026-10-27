<script setup lang="ts">
// CityEvents - the city's calendar made visible: Friday Jumu'ah crowds
// praying in rows outside the Sultan Bello Mosque, Sunday worshippers at St
// Joseph's, market-day shoppers at Central Market, and the Sallah / Christmas
// festivals at Murtala Square (bunting, lights and dancing). Only built when
// you're within range, so it costs nothing elsewhere.
import * as THREE from 'three'
import { BAKE } from '~/utils/kaduna'
import { heightAt } from '~/utils/terrain'
import { hitsBuilding } from '~/utils/collision'
import { lookFor } from '~/utils/wardrobe'
import { legacyLook, type PersonLook } from '~/utils/people'
import { useClock } from '~/composables/useTimeOfDay'
import { useInterior } from '~/composables/useControlsState'
import { weekdayOf } from '~/utils/lifeShared'
import { CLEAR_ZONES, clearZones } from '~/utils/parksShared'

const hour = useClock()
const day = useState<number>('kk_day', () => 1)
const playerPos = useState<[number, number, number]>('kk_player_pos')
const interior = useInterior()

interface Person { id: number; x: number; z: number; y: number; yaw: number; female: boolean; mode: string; top: string; bottom: string; look?: PersonLook }
const people = shallowRef<Person[]>([])
const bunting = new THREE.Group()
bunting.visible = false

// by key in Kaduna; in the other towns the first landmark of that kind
const KIND: Record<string, string> = { bello_mosque: 'mosque', st_joseph: 'cathedral', central_market: 'market', murtala_square: 'square' }
const lm = (k: string) => BAKE.landmarks.find((l) => l.key === k) ?? BAKE.landmarks.find((l) => l.kind === KIND[k])
function active(): { key: string; kind: string } | null {
  const w = weekdayOf(day.value)
  const h = hour.value
  const fest = day.value % 20 === 9 ? 'sallah' : day.value % 20 === 19 ? 'christmas' : null
  if (fest && h >= 9 && h < 22) return { key: 'murtala_square', kind: fest }
  if (w === 4 && h >= 12.5 && h < 14.5) return { key: 'bello_mosque', kind: 'jumuah' }
  if (w === 6 && h >= 8 && h < 11.5) return { key: 'st_joseph', kind: 'service' }
  if ((w === 0 || w === 3) && h >= 7 && h < 18) return { key: 'central_market', kind: 'market' }
  return null
}

function nearestRoad(x: number, z: number): [number, number, number] {
  let best: [number, number, number] = [x, z + 20, 0]
  let bd = Infinity
  for (const r of BAKE.roads) {
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1]!
      const [bx, bz] = r.pts[i]!
      const dx = bx - ax
      const dz = bz - az
      const L2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
      const qx = ax + dx * t
      const qz = az + dz * t
      const d = Math.hypot(qx - x, qz - z)
      if (d < bd && d > 8) (bd = d), (best = [qx, qz, Math.atan2(dx, dz)])
    }
  }
  return best
}
const mats: Array<{ x: number; z: number; rot: number; w: number; d: number; color: string }> = []
const matGroup = new THREE.Group()

function build(ev: { key: string; kind: string }) {
  mats.length = 0
  const l = lm(ev.key)
  if (!l) return []
  const out: Person[] = []
  let id = 5000
  const push = (x: number, z: number, yaw: number, mode: string, female: boolean, dress?: Partial<Person>) => {
    if (hitsBuilding(x, z, 0.4)) return
    const look = lookFor(id, female)
    const p: Person = { id, x, z, y: heightAt(x, z), yaw, mode, female, top: look.top, bottom: look.bottom, ...dress }
    p.look = legacyLook({ female, skin: look.skin, shirt: p.top, trouser: p.bottom, seed: id })
    out.push(p)
    id++
  }
  const off = Math.max(l.kw, l.kd) / 2 + 6
  // find an open block next to the landmark (streets count - Jumu'ah
  // overflow really does spill onto the road)
  const clear = (cx: number, cz: number, w: number, d: number) => {
    for (let i = -w / 2; i <= w / 2; i += 2) for (let j = -d / 2; j <= d / 2; j += 2) if (hitsBuilding(cx + i, cz + j, 0.6)) return false
    return true
  }
  const spot = (w: number, d: number): [number, number] => {
    for (let k = 0; k < 600; k++) {
      const a = k * 2.399
      const r = off + Math.sqrt(k) * 3
      const x = l.x + Math.cos(a) * r
      const z = l.z + Math.sin(a) * r
      if (clear(x, z, w, d)) return [x, z]
    }
    return [l.x, l.z + off]
  }
  if (ev.kind === 'jumuah') {
    // rows facing the qibla (roughly north-east from Kaduna)
    // Jumu'ah overflow: rows of worshippers on mats in the street right
    // outside the mosque (as happens every Friday), facing the qibla
    const qibla = Math.atan2(0.6, -0.8)
    const [rx, rz, rh] = nearestRoad(l.x, l.z)
    const ax = Math.sin(rh)
    const az = Math.cos(rh) // along the road
    const px = Math.cos(rh)
    const pz = -Math.sin(rh) // across the road
    for (let r = 0; r < 5; r++) for (let c = -8; c <= 8; c++) {
      const x = rx + ax * c * 1.1 + px * (r - 2) * 1.35
      const z = rz + az * c * 1.1 + pz * (r - 2) * 1.35
      push(x, z, qibla, 'pray', false, { top: ['#efe8d6', '#f2f2f0', '#c9b78e', '#d9e4ea'][(r + c + 16) % 4], bottom: ['#2b3440', '#3a3f4a', '#1d1c1f'][(r + c + 16) % 3] })
    }
    mats.push({ x: rx, z: rz, rot: rh, w: 19, d: 7.4, color: '#2f6b4f' })
  } else if (ev.kind === 'service') {
    const [bx, bz] = spot(15, 8)
    for (let r = 0; r < 4; r++) for (let c = -5; c <= 5; c++) push(bx + c * 1.2, bz - 2 + r * 1.5, Math.PI, 'worship', (r + c) % 2 === 0)
  } else if (ev.kind === 'market') {
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2
      const rr = off + 4 + (i % 4) * 2.5
      push(l.x + Math.cos(a) * rr, l.z + Math.sin(a) * rr * 0.8, a + Math.PI / 2, i % 3 === 0 ? 'talk' : 'browse', i % 2 === 0)
    }
  } else {
    // festival: dancers + people chatting around the square
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2
      const rr = 18 + (i % 3) * 3
      const fest = ev.kind === 'sallah'
      push(l.x + Math.cos(a) * rr, l.z + Math.sin(a) * rr, a + Math.PI, i % 3 === 0 ? 'talk' : 'dance', i % 2 === 0,
        fest ? { top: ['#0e7c66', '#efe8d6', '#6b2fa0', '#d4a017'][i % 4] } : { top: ['#c81d25', '#1aa34a', '#ffffff'][i % 3] })
    }
  }
  // bunting / fairy lights strung around the square for festivals
  bunting.clear()
  if (ev.kind === 'sallah' || ev.kind === 'christmas') {
    const cols = ev.kind === 'sallah' ? ['#0e7c66', '#ffffff', '#d4a017'] : ['#c81d25', '#1aa34a', '#ffd700']
    const flagG = new THREE.ConeGeometry(0.35, 0.7, 3)
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2
      const m = new THREE.Mesh(flagG, new THREE.MeshBasicMaterial({ color: cols[i % cols.length] }))
      m.position.set(l.x + Math.cos(a) * 28, heightAt(l.x, l.z) + 4.2 + Math.sin(i * 0.7) * 0.25, l.z + Math.sin(a) * 28)
      m.rotation.x = Math.PI
      bunting.add(m)
    }
    bunting.visible = true
  } else bunting.visible = false
  return out
}

let cur = ''
let acc = 0
const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  const now = performance.now()
  if (now - acc < 1000) return
  acc = now
  const ev = active()
  const l = ev ? lm(ev.key) : null
  const close = !!l && !interior.value.inside && Math.hypot(l.x - playerPos.value[0], l.z - playerPos.value[2]) < 220
  const key = close && ev ? `${ev.key}:${ev.kind}:${day.value}` : ''
  if (key === cur) return
  cur = key
  people.value = close && ev ? build(ev) : []
  // prayer mats under the rows, and keep the grass off where people stand
  matGroup.clear()
  CLEAR_ZONES.length = 0
  for (const m of mats) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(m.d, m.w), new THREE.MeshLambertMaterial({ color: m.color }))
    g.rotation.set(-Math.PI / 2, 0, m.rot)
    g.position.set(m.x, heightAt(m.x, m.z) + 0.06, m.z)
    matGroup.add(g)
  }
  for (const p of people.value) CLEAR_ZONES.push({ x: p.x, z: p.z, r: 1.2 })
  clearZones.version++
  if (!close) bunting.visible = false
})
if (import.meta.dev && typeof window !== 'undefined') (window as any).__kk_cityevent = () => ({ active: active(), people: people.value.length, at: people.value[0] ? [people.value[0].x, people.value[0].z] : null })
</script>

<template>
  <primitive :object="bunting" />
  <primitive :object="matGroup" />
  <TresGroup v-for="p in people" :key="p.id" :position="[p.x, p.y, p.z]" :rotation-y="p.yaw">
    <CharacterAvatar :person="p.look" :mode="p.mode as any" :phase="(p.id % 11) * 0.37" />
  </TresGroup>
</template>
