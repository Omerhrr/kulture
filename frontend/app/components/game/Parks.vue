<script setup lang="ts">
// Parks - green spaces with life in them: a jogging path round the lawn
// with joggers, families and friends on the benches, kids on the swings
// and slide, a suya stand, people chatting under the trees. The parks are
// laid out on open ground near the start; their people only render when
// you are close (they are full mocap characters).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PLAYABLE_POS } from '~/utils/kaduna'
import { hashDist, roadHash, hash01 } from '~/utils/kadunaExtras'
import { hitsBuilding, addColliders } from '~/utils/collision'
import { registerSeat } from '~/utils/seats'
import { lookFor } from '~/utils/wardrobe'
import { heightAt } from '~/utils/terrain'
import { housePlacements } from '~/utils/housing'
import { PARK_AREAS } from '~/utils/parksShared'
import { makeLabelTexture } from '~/utils/sign'
import type { Activity } from '~/utils/poses'

interface ParkPerson {
  id: number
  park: number
  x: number
  z: number
  yaw: number
  mode: Activity | 'idle' | 'walk' | 'sit'
  seat?: number
  female: boolean
  kid?: boolean
  /** joggers / walkers loop the path */
  loop?: { r: number; speed: number; a0: number }
}
interface Park {
  x: number
  z: number
  r: number
  name: string
}

const NAMES = ['Murtala Square Park', 'Kaduna Millennium Park', 'Gamji Gate Park', 'Barnawa Green', 'Ungwan Rimi Gardens']
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const interior = useInterior()
const parks: Park[] = PARK_AREAS
const people: ParkPerson[] = []
const root = new THREE.Group()
const signs = ref<Array<{ tex: THREE.Texture; x: number; y: number; z: number }>>([])

const why = { road: 0, bld: 0, hill: 0, near: 0, ok: 0, runs: 0 }
function findParks() {
  why.runs++
  const [sx, sz] = PLAYABLE_POS.spawn_roadside
  const R = 13
  for (let ring = 40; ring < 1600 && parks.length < 4; ring += 20) {
    for (let k = 0; k < 36 && parks.length < 4; k++) {
      const a = (k / 36) * Math.PI * 2 + ring * 0.01
      const x = sx + Math.cos(a) * ring
      const z = sz + Math.sin(a) * ring
      const rd = hashDist(roadHash(), x, z, 60)
      if (rd < R + 7 || rd > R + 60) {
        why.road++
        continue // near a road, not on it
      }
      let clear = true
      for (let i = 0; i < 12 && clear; i++) {
        const b = (i / 12) * Math.PI * 2
        if (hitsBuilding(x + Math.cos(b) * R, z + Math.sin(b) * R, 1.5) || hitsBuilding(x + Math.cos(b) * R * 0.5, z + Math.sin(b) * R * 0.5, 1.5)) clear = false
      }
      if (!clear || hitsBuilding(x, z, 2)) {
        why.bld++
        continue
      }
      if (Math.abs(heightAt(x, z)) > 0.5 || Math.abs(heightAt(x + R, z)) > 0.8 || Math.abs(heightAt(x - R, z)) > 0.8) continue
      if (parks.some((p) => Math.hypot(p.x - x, p.z - z) < 120)) continue
      // never on a house plot (some plots are empty yards with a gate)
      if (housePlacements().some((pl) => Math.hypot(pl.x - x, pl.z - z) < R + 6)) {
        why.bld++
        continue
      }
      parks.push({ x, z, r: R, name: NAMES[parks.length % NAMES.length] })
    }
  }
}

function col(geo: THREE.BufferGeometry, hex: string) {
  const g = geo.index ? geo.toNonIndexed() : geo
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
  const c = new THREE.Color(hex)
  const arr = new Float32Array(g.attributes.position.count * 3)
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = c.r
    arr[i + 1] = c.g
    arr[i + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

function buildPark(p: Park, pi: number) {
  const G: THREE.BufferGeometry[] = []
  const solids: Array<{ x: number; z: number; w: number; d: number }> = []
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, hex: string) => G.push(col(g.translate(p.x + x, y, p.z + z), hex))
  // lawn + ring path
  at(new THREE.CircleGeometry(p.r, 48).rotateX(-Math.PI / 2), 0, 0.03, 0, '#5f8a3e')
  at(new THREE.RingGeometry(p.r * 0.72, p.r * 0.82, 64).rotateX(-Math.PI / 2), 0, 0.045, 0, '#c9b78e')
  at(new THREE.TorusGeometry(p.r, 0.12, 6, 64).rotateX(Math.PI / 2), 0, 0.12, 0, '#c8c4b8')
  // trees
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3
    const x = Math.cos(a) * p.r * 0.92
    const z = Math.sin(a) * p.r * 0.92
    at(new THREE.CylinderGeometry(0.18, 0.28, 3, 7), x, 1.5, z, '#6b4a2f')
    at(new THREE.SphereGeometry(1.8, 10, 8).scale(1, 0.8, 1), x, 3.8, z, i % 2 ? '#4f7d3f' : '#5d8a46')
    solids.push({ x: p.x + x, z: p.z + z, w: 0.6, d: 0.6 })
  }
  // benches on the inner side of the path, facing the middle
  const benches: Array<[number, number, number]> = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const x = Math.cos(a) * p.r * 0.62
    const z = Math.sin(a) * p.r * 0.62
    const yaw = Math.atan2(-x, -z)
    const seat = new THREE.BoxGeometry(1.6, 0.06, 0.45).rotateY(yaw)
    const back = new THREE.BoxGeometry(1.6, 0.45, 0.06).translate(0, 0.25, -0.2).rotateY(yaw)
    at(seat, x, 0.45, z, '#8a5a34')
    at(back, x, 0.5, z, '#8a5a34')
    at(new THREE.BoxGeometry(1.5, 0.42, 0.35).rotateY(yaw), x, 0.21, z, '#3a3d42')
    benches.push([x, z, yaw])
    for (const off of [-0.45, 0.45]) {
      registerSeat({ x: p.x + x + Math.cos(yaw) * off, z: p.z + z - Math.sin(yaw) * off, yaw, h: 0.47, label: 'Park bench' })
    }
  }
  // playground: swing frame + slide
  const pg = { x: -p.r * 0.25, z: p.r * 0.2 }
  at(new THREE.BoxGeometry(0.1, 2.2, 0.1), pg.x - 1, 1.1, pg.z, '#d8473a')
  at(new THREE.BoxGeometry(0.1, 2.2, 0.1), pg.x + 1, 1.1, pg.z, '#d8473a')
  at(new THREE.BoxGeometry(2.2, 0.1, 0.1), pg.x, 2.2, pg.z, '#d8473a')
  at(new THREE.BoxGeometry(0.5, 0.05, 0.25), pg.x - 0.45, 0.5, pg.z, '#2a2d33')
  at(new THREE.BoxGeometry(0.5, 0.05, 0.25), pg.x + 0.45, 0.5, pg.z, '#2a2d33')
  at(new THREE.BoxGeometry(0.7, 0.05, 2.4).rotateX(0.55), pg.x + 2.5, 0.75, pg.z + 0.2, '#f2c12e')
  at(new THREE.BoxGeometry(0.8, 1.4, 0.8), pg.x + 2.5, 0.7, pg.z - 1.2, '#1f4fa0')
  solids.push({ x: p.x + pg.x + 2.5, z: p.z + pg.z - 1.2, w: 0.8, d: 0.8 })
  // suya stand
  const sv = { x: p.r * 0.35, z: -p.r * 0.3 }
  at(new THREE.BoxGeometry(1.6, 0.9, 0.7), sv.x, 0.45, sv.z, '#6b4a2f')
  at(new THREE.BoxGeometry(1.8, 0.06, 1.2), sv.x, 2.2, sv.z, '#d8473a')
  for (const dx of [-0.8, 0.8]) at(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), sv.x + dx, 1.1, sv.z + 0.5, '#3a3d42')
  at(new THREE.BoxGeometry(0.9, 0.06, 0.4), sv.x, 0.94, sv.z, '#2a2d33')
  solids.push({ x: p.x + sv.x, z: p.z + sv.z, w: 1.6, d: 0.7 })
  addColliders(solids as any)
  const geo = mergeGeometries(G, false)
  for (const g of G) g.dispose()
  if (geo) {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
    m.receiveShadow = true
    m.castShadow = true
    root.add(m)
  }
  signs.value.push({ tex: makeLabelTexture(`🌳 ${p.name.toUpperCase()}`, '#d8f2c0'), x: p.x, y: 6, z: p.z })

  // people
  let id = 5000 + pi * 100
  const add = (o: Omit<ParkPerson, 'id' | 'park' | 'female'> & { female?: boolean }) => people.push({ id: id++, park: pi, female: hash01(id, pi, 3) < 0.5, ...o } as ParkPerson)
  benches.forEach(([x, z, yaw], k) => {
    if (k % 3 === 2) return
    add({ x: x + Math.cos(yaw) * -0.45, z: z - Math.sin(yaw) * -0.45, yaw, mode: k % 2 ? 'read' : 'talk', seat: 0.47 })
    if (k % 2 === 0) add({ x: x + Math.cos(yaw) * 0.45, z: z - Math.sin(yaw) * 0.45, yaw, mode: 'drink', seat: 0.47 })
  })
  // joggers + strollers on the path
  for (let k = 0; k < 4; k++) add({ x: 0, z: 0, yaw: 0, mode: k < 2 ? 'run' : 'walk', loop: { r: p.r * 0.77, speed: k < 2 ? 2.6 : 1.1, a0: k * 1.6 } })
  // kids at the playground, a parent watching
  add({ x: pg.x - 0.45, z: pg.z + 0.1, yaw: 0, mode: 'sit', seat: 0.5, kid: true })
  add({ x: pg.x + 2.5, z: pg.z + 1.6, yaw: Math.PI, mode: 'dance', kid: true })
  add({ x: pg.x, z: pg.z + 1.6, yaw: Math.PI, mode: 'talk' })
  // suya man + customers, friends chatting on the grass
  add({ x: sv.x, z: sv.z - 0.6, yaw: 0, mode: 'cook', female: false })
  add({ x: sv.x - 0.3, z: sv.z + 1.0, yaw: Math.PI, mode: 'talk' })
  add({ x: -p.r * 0.1, z: -p.r * 0.35, yaw: 0.8, mode: 'talk' })
  add({ x: -p.r * 0.1 + 0.9, z: -p.r * 0.35 + 0.7, yaw: 0.8 + Math.PI, mode: 'talk' })
}

// laid out once the city (and its building colliders / seats) exists
let built = false
function ensureParks() {
  if (built) return
  built = true
  findParks()
  parks.forEach(buildPark)
}

// ---- only the park you are near is populated
const near = ref<Array<ParkPerson & { look: ReturnType<typeof lookFor> }>>([])
let nearPark = -1
const groups = new Map<number, THREE.Object3D>()
const setRef = (id: number) => (el: any) => {
  const o = el?.instance ?? el?.value ?? el
  if (o?.isObject3D) groups.set(id, o)
  else groups.delete(id)
}
let t = 0
let check = 0
const bootAt = typeof performance !== 'undefined' ? performance.now() : 0
if (import.meta.dev && typeof window !== 'undefined') (window as any).__kk_parks = () => ({ t, why, parks: parks.map((p) => [p.name, Math.round(p.x), Math.round(p.z)]) })
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  const dt = Math.min(delta || 0.016, 0.1)
  t += dt
  if (performance.now() - bootAt > 2500) ensureParks()
  check -= dt
  if (check <= 0) {
    check = 0.6
    const [px, , pz] = playerPos.value
    let best = -1
    if (!interior.value.inside) {
      parks.forEach((p, i) => {
        if (Math.hypot(p.x - px, p.z - pz) < 90) best = i
      })
    }
    if (best !== nearPark) {
      nearPark = best
      near.value = best < 0 ? [] : people.filter((q) => q.park === best).map((q) => ({ ...q, look: lookFor(q.id, q.female) }))
    }
  }
  // joggers go round
  for (const q of near.value) {
    if (!q.loop) continue
    const g = groups.get(q.id)
    if (!g) continue
    const p = parks[q.park]
    const a = q.loop.a0 + (t * q.loop.speed) / q.loop.r
    g.position.set(p.x + Math.cos(a) * q.loop.r, 0, p.z + Math.sin(a) * q.loop.r)
    g.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a))
  }
})
</script>

<template>
  <TresGroup>
    <primitive :object="root" />
    <TresGroup
      v-for="q in near"
      :key="q.id"
      :ref="setRef(q.id)"
      :position="[parks[q.park].x + q.x, 0, parks[q.park].z + q.z]"
      :rotation-y="q.yaw"
    >
      <CharacterAvatar
        real
        :female="q.female"
        :skin="q.look.skin"
        :shirt="q.look.top"
        :trouser="q.look.bottom"
        :hair-color="q.look.hair ?? '#141114'"
        :hair-style="q.female ? 'braids' : 'cap'"
        :kufi="false"
        :hijab="false"
        :outfit="q.female ? 'dress' : 'shirt'"
        :gadgets="(q.look.gadgets ?? []) as any"
        :mode="q.mode as any"
        :seat="q.seat ?? 0.47"
        :scale="q.kid ? 0.68 : 1"
        :phase="(q.id % 13) * 0.41"
        :gait-speed="q.mode === 'run' ? 14 : 8"
      />
    </TresGroup>
    <TresSprite v-for="(s, i) in signs" :key="'ps' + i" :position="[s.x, s.y, s.z]" :scale="[9, 1.7, 1]">
      <TresSpriteMaterial :map="s.tex" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
