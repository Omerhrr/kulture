<script setup lang="ts">
// CrewClubhouse - each crew (Phone → Crews) has a clubhouse in town on a
// plot everyone agrees on (derived from the crew id): a painted block
// with the crew colours, a flag and the tag in lights. Hanging out there
// fills your social need. Phone → Crews → Clubhouse rides you over.
import * as THREE from 'three'
import { BAKE } from '~/utils/kaduna'
import { hitsBuilding, addColliders } from '~/utils/collision'
import { hashDist, roadHash, houseHash } from '~/utils/kadunaExtras'
import { heightAt } from '~/utils/terrain'
import { makeLabelTexture } from '~/utils/sign'
import { useSimStore } from '~/stores/sim'

const api = useGameApi()
const sim = useSimStore()
const playerPos = useState<[number, number, number]>('kk_player_pos')
const root = new THREE.Group()
const placed = new Map<string, { x: number; z: number; rot: number; name: string }>()
let mine: string | null = null

function hashStr(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function plotFor(id: string): [number, number, number] {
  const h = hashStr('crew:' + id)
  const anchors = BAKE.landmarks.filter((l) => ['park', 'square', 'stadium', 'market'].includes(l.kind))
  const a = anchors[h % Math.max(1, anchors.length)] ?? BAKE.landmarks[0]!
  for (let k = (h >> 5) % 60; k < 3000; k++) {
    const ang = k * 2.399
    const r = 60 + Math.sqrt(k) * 8
    const x = a.x + Math.cos(ang) * r
    const z = a.z + Math.sin(ang) * r
    const rd = hashDist(roadHash(), x, z, 40)
    if (rd < 14 || rd > 26 || hitsBuilding(x, z, 10) || hashDist(houseHash(), x, z, 30) < 13) continue
    if ([...placed.values()].some((p) => Math.hypot(p.x - x, p.z - z) < 24)) continue
    let best = 0
    let bd = Infinity
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2
      const d = hashDist(roadHash(), x + Math.sin(t) * 10, z + Math.cos(t) * 10, 40)
      if (d < bd) (bd = d), (best = t)
    }
    return [x, z, best]
  }
  return [a.x + 80, a.z - 80, 0]
}

function clubhouse(c: { id: string; name: string; tag: string; color: string }, x: number, z: number, rot: number) {
  const g = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.8 })
  const wall = new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.9 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(12, 4.6, 9), wall)
  body.position.y = 2.3
  body.castShadow = body.receiveShadow = true
  const band = new THREE.Mesh(new THREE.BoxGeometry(12.1, 0.9, 9.1), paint)
  band.position.y = 3.7
  const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.8), new THREE.MeshStandardMaterial({ color: '#111', emissive: c.color, emissiveIntensity: 0.25 }))
  door.position.set(0, 1.4, 4.51)
  // benches + a parked bike outside
  for (const bx of [-4, 4]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: '#6b4a2f' }))
    bench.position.set(bx, 0.45, 6.2)
    g.add(bench)
  }
  // flag pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 7), new THREE.MeshStandardMaterial({ color: '#ccc', metalness: 0.6 }))
  pole.position.set(5.4, 3.5, 5.4)
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({ color: c.color, side: THREE.DoubleSide }))
  flag.position.set(6.3, 6.3, 5.4)
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`[${c.tag}] ${c.name.toUpperCase()}`, '#ffffff'), transparent: true, depthWrite: false }))
  sign.position.set(0, 6, 4.6)
  sign.scale.set(11, 2, 1)
  const sub = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture('CREW CLUBHOUSE', '#ffe08a'), transparent: true, depthWrite: false }))
  sub.position.set(0, 5.1, 4.6)
  sub.scale.set(6, 1.1, 1)
  g.add(body, band, door, pole, flag, sign, sub)
  g.position.set(x, heightAt(x, z), z)
  g.rotation.y = rot
  g.name = c.id
  return g
}

async function refresh() {
  try {
    const d = await api.apiGet<any>('/crews')
    mine = d.mine?.id ?? null
    // my crew's clubhouse always; the biggest few others too
    const list = [...(d.mine ? [d.mine] : []), ...d.crews.filter((c: any) => c.id !== mine).sort((a: any, b: any) => b.members.length - a.members.length).slice(0, 5)]
    for (const c of list) {
      const p = placed.get(c.id)
      if (p && p.name === c.name) continue
      const [x, z, rot] = p ? [p.x, p.z, p.rot] : plotFor(c.id)
      const old = root.getObjectByName(c.id)
      if (old) root.remove(old)
      placed.set(c.id, { x, z, rot, name: c.name })
      root.add(clubhouse(c, x, z, rot))
      if (!old) addColliders([{ x, z, w: 12.5, d: 9.5 }] as any)
    }
  } catch {}
}
function goThere() {
  const p = mine && placed.get(mine)
  if (!p) return refresh()
  window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'place', place: { name: `${p.name} clubhouse`, to: [p.x + Math.sin(p.rot) * 9, p.z + Math.cos(p.rot) * 9] } } }))
}
let timer: any
let hang: any
onMounted(() => {
  setTimeout(refresh, 5000)
  timer = setInterval(refresh, 90_000)
  window.addEventListener('kk-clubhouse', goThere)
  // hanging out at your clubhouse fills your social need
  hang = setInterval(() => {
    const p = mine && placed.get(mine)
    const me = playerPos.value
    if (p && me && Math.hypot(me[0] - p.x, me[2] - p.z) < 16) {
      sim.needs.social = Math.min(100, sim.needs.social + 2)
      sim.needs.fun = Math.min(100, sim.needs.fun + 1)
    }
  }, 5000)
  if (import.meta.dev) (window as any).__kk_clubhouses = () => [...placed.entries()].map(([id, p]) => ({ id, ...p }))
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(hang)
  window.removeEventListener('kk-clubhouse', goThere)
})
</script>

<template>
  <primitive :object="root" />
</template>
