<script setup lang="ts">
// PlayerBusinesses - shops and restaurants opened by players (Phone → Life)
// stand in the world on a plot that is the same for everybody (derived from
// the owner id): a shopfront with an awning, a counter and the name in
// lights. Walk up and buy something - the owner gets 70% (server side).
import * as THREE from 'three'
import { BAKE } from '~/utils/kaduna'
import { hitsBuilding, addColliders } from '~/utils/collision'
import { hashDist, roadHash, houseHash } from '~/utils/kadunaExtras'
import { heightAt } from '~/utils/terrain'
import { makeLabelTexture } from '~/utils/sign'
import { useInterior } from '~/composables/useControlsState'

const api = useGameApi()
const playerPos = useState<[number, number, number]>('kk_player_pos')
const interior = useInterior()
const near = useState<null | { owner_id: string; owner: string; name: string; kind: string }>('kk_biz_near', () => null)

interface Biz { owner_id: string; owner: string; name: string; kind: string; x: number; z: number; rot: number }
const list = shallowRef<Biz[]>([])
const root = new THREE.Group()
const placed = new Map<string, Biz>()

// business districts: Central Market, Ahmadu Bello Way (Murtala), Kawo
const ANCHORS = ['central_market', 'murtala_square', 'kawo_park', 'gamji_gate']
function hashStr(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const taken: Array<[number, number]> = []
function plotFor(id: string): [number, number, number] {
  const h = hashStr(id)
  const anchors = BAKE.landmarks.filter((l) => ANCHORS.includes(l.key) || ['market', 'square', 'motorpark'].includes(l.kind))
  const a = anchors[h % Math.max(1, anchors.length)] ?? BAKE.landmarks[0]!
  for (let k = (h >> 4) % 50; k < 3000; k++) {
    const ang = k * 2.399
    const r = 45 + Math.sqrt(k) * 7
    const x = a.x + Math.cos(ang) * r
    const z = a.z + Math.sin(ang) * r
    const rd = hashDist(roadHash(), x, z, 40)
    // a shopfront wants the road close (8-20 m) but no building on the plot
    if (rd < 13 || rd > 24 || hitsBuilding(x, z, 8) || hashDist(houseHash(), x, z, 30) < 11) continue
    if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 18)) continue
    // face the nearest road: probe 8 directions
    let best = 0
    let bd = Infinity
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2
      const d = hashDist(roadHash(), x + Math.sin(t) * 10, z + Math.cos(t) * 10, 40)
      if (d < bd) (bd = d), (best = t)
    }
    taken.push([x, z])
    return [x, z, best]
  }
  return [a.x + 60, a.z + 60, 0]
}

function building(b: Biz) {
  const g = new THREE.Group()
  const rest = b.kind === 'restaurant'
  const wall = new THREE.MeshStandardMaterial({ color: rest ? '#f1e3c8' : '#e8edf0', roughness: 0.9 })
  const trim = new THREE.MeshStandardMaterial({ color: rest ? '#8a2b1f' : '#1f6f4a' })
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 4.2, 8), wall)
  box.position.y = 2.1
  box.castShadow = box.receiveShadow = true
  g.add(box)
  // glass front + door
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.4), new THREE.MeshStandardMaterial({ color: '#9fc6d8', roughness: 0.1, metalness: 0.3, emissive: '#3a4a50', emissiveIntensity: 0.3 }))
  glass.position.set(0, 1.6, 4.01)
  g.add(glass)
  // striped awning
  const aw = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.2, 2.2), trim)
  aw.position.set(0, 3.3, 5)
  aw.rotation.x = 0.25
  g.add(aw)
  // counter / stall outside
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1), new THREE.MeshStandardMaterial({ color: '#7a5230' }))
  counter.position.set(-3, 0.5, 5.6)
  g.add(counter)
  if (rest) {
    for (const x of [1.5, 3.8]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 14), new THREE.MeshStandardMaterial({ color: '#ffffff' }))
      t.position.set(x, 0.8, 6.4)
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8), trim)
      leg.position.set(x, 0.4, 6.4)
      g.add(t, leg)
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: ['#e0a030', '#c0392b', '#27ae60', '#f1c40f'][i] }))
      crate.position.set(-3.8 + i * 0.75, 1.25, 5.6)
      g.add(crate)
    }
  }
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`${rest ? '🍲' : '🛒'} ${b.name.toUpperCase()}`, rest ? '#ffd9a0' : '#c8f7d8'), transparent: true, depthWrite: false }))
  sign.position.set(0, 5.4, 4)
  sign.scale.set(10, 1.9, 1)
  g.add(sign)
  const owner = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`owner: ${b.owner}`, '#ffffff'), transparent: true, depthWrite: false }))
  owner.position.set(0, 4.6, 4)
  owner.scale.set(6, 1.1, 1)
  g.add(owner)
  g.position.set(b.x, heightAt(b.x, b.z), b.z)
  g.rotation.y = b.rot
  g.name = b.owner_id
  return g
}

async function refresh() {
  const w = window as any
  w.__kk_bizstage = 'fetch'
  try {
    const r = await api.apiGet<any>('/life/businesses')
    w.__kk_bizstage = 'got ' + r.businesses.length
    const out: Biz[] = []
    for (const b of r.businesses as any[]) {
      let p = placed.get(b.owner_id)
      if (!p || p.name !== b.name) {
        const [x, z, rot] = p ? [p.x, p.z, p.rot] : plotFor(b.owner_id)
        const old = root.getObjectByName(b.owner_id)
        if (old) root.remove(old)
        p = { owner_id: b.owner_id, owner: b.owner, name: b.name, kind: b.kind, x, z, rot }
        placed.set(b.owner_id, p)
        root.add(building(p))
        if (!old) addColliders([{ x, z, w: 10.5, d: 10.5 }] as any)
      }
      out.push(p)
    }
    list.value = out
  } catch (e) {
    ;(window as any).__kk_bizerr = String((e as Error)?.stack || e)
  }
}
let timer: any
onMounted(() => {
  // wait for the city colliders so plots avoid real buildings
  setTimeout(refresh, 4000)
  timer = setInterval(refresh, 60_000)
  window.addEventListener('kk-business-changed', refresh)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('kk-business-changed', refresh)
})

let acc = 0
const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  const now = performance.now()
  if (now - acc < 400) return
  acc = now
  if (interior.value.inside) return void (near.value = null)
  const [px, , pz] = playerPos.value
  let best: Biz | null = null
  for (const b of list.value) {
    // the shopfront is 5 m in front of the box centre
    const fx = b.x + Math.sin(b.rot) * 5.5
    const fz = b.z + Math.cos(b.rot) * 5.5
    if (Math.hypot(fx - px, fz - pz) < 6) best = b
  }
  if (best?.owner_id !== near.value?.owner_id) near.value = best ? { owner_id: best.owner_id, owner: best.owner, name: best.name, kind: best.kind } : null
})
if (typeof window !== 'undefined') (window as any).__kk_bizlist = () => list.value.map((b) => ({ ...b }))
</script>

<template>
  <primitive :object="root" />
</template>
