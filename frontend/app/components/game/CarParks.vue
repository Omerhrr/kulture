<script setup lang="ts">
// CarParks - some homes (duplexes and blocks of flats) have a paved car
// park beside the gate, often with the family car standing in it. Built
// only around you (within ~220 m) and dropped again when you are far away,
// so a phone never holds thousands of them.
import * as THREE from 'three'
import { housePlacements, ND } from '~/utils/housing'
import { hash01, hashDist, roadHash } from '~/utils/kadunaExtras'
import { hitsBuilding, addColliders } from '~/utils/collision'
import { heightAt } from '~/utils/terrain'
import { paintedVehicle, vehicleMaterial } from '~/utils/vehicles'
import { perf } from '~/utils/quality'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [0, 0, 0])
const homeFront = useState<{ x: number; z: number } | null>('kk_home_front', () => null)
const root = new THREE.Group()
const carMat = vehicleMaterial()
const padMat = new THREE.MeshStandardMaterial({ color: '#45464b', roughness: 0.95 })
const lineMat = new THREE.MeshBasicMaterial({ color: '#efefe6' })
const PAINT = ['#b9bcc2', '#f2f2ee', '#121212', '#3f6fae', '#b8433a', '#2f7d5b', '#6a4a8a', '#c9a24a']
const RANGE = perf().low ? 150 : 220

interface Lot {
  i: number
  x: number
  z: number
  h: number
  group: THREE.Group | null
}
let lots: Lot[] | null = null
const solid = new Set<number>()

/** which homes have a car park, and where (computed once, lazily) */
function candidates(): Lot[] {
  if (lots) return lots
  lots = []
  housePlacements().forEach((pl, i) => {
    if (!(pl.type === 'duplex' || pl.type === 'hipduplex' || pl.type === 'flats')) return
    if (hash01(pl.x, pl.z, 77) > 0.42) return
    lots!.push({ i, x: pl.x, z: pl.z, h: pl.yaw, group: null })
  })
  return lots
}
function spotFor(i: number): [number, number, number] | null {
  const pl = housePlacements()[i]!
  const nx = Math.sin(pl.yaw)
  const nz = Math.cos(pl.yaw)
  const depth = pl.sz * ND
  const gx = pl.x + nx * (depth / 2)
  const gz = pl.z + nz * (depth / 2)
  const hf = homeFront.value
  if (hf && Math.hypot(hf.x - gx, hf.z - gz) < 12) return null // your home has its own
  for (const side of [1, -1]) {
    for (let off = 4; off <= 10; off += 1.5) {
      for (const out of [3, 4.2, 2.2]) {
        const x = gx - nz * off * side + nx * out
        const z = gz + nx * off * side + nz * out
        if (!hitsBuilding(x, z, 2.1) && hashDist(roadHash(), x, z, 20) > 3.3) return [x, z, pl.yaw + Math.PI]
      }
    }
  }
  return null
}
function build(l: Lot): THREE.Group | null {
  const s = spotFor(l.i)
  if (!s) return null
  const [x, z, h] = s
  const g = new THREE.Group()
  const bays = 2
  const pad = new THREE.Mesh(new THREE.BoxGeometry(3.3 * bays, 0.06, 5.8), padMat)
  pad.position.y = 0.03
  pad.receiveShadow = true
  g.add(pad)
  for (let b = 0; b <= bays; b++) {
    const ln = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 5.4), lineMat)
    ln.position.set(-1.65 * bays + b * 3.3, 0.07, 0)
    g.add(ln)
  }
  // 0-2 family cars parked in the bays
  const n = Math.floor(hash01(l.x, l.z, 91) * 3)
  const boxes: Array<{ x: number; z: number; w: number; d: number }> = []
  for (let c = 0; c < n; c++) {
    const { group } = paintedVehicle('car', PAINT[Math.floor(hash01(l.x + c, l.z, 93) * PAINT.length)], carMat)
    // paintedVehicle clones the mesh tree but shares the cached spec's
    // BufferGeometries: mark them so teardown skips disposing them
    group.traverse((o) => {
      const g = (o as THREE.Mesh).geometry
      if (g) g.userData.kkShared = true
    })
    const bx = -1.65 * bays + 1.65 + c * 3.3
    group.position.set(bx, 0, 0.2)
    g.add(group)
    // world box for collisions
    const wx = x + Math.cos(h) * bx + Math.sin(h) * 0.2
    const wz = z - Math.sin(h) * bx + Math.cos(h) * 0.2
    boxes.push({ x: wx, z: wz, w: 3.2, d: 3.2 })
  }
  if (boxes.length && !solid.has(l.i)) {
    addColliders(boxes as any)
    solid.add(l.i)
  }
  g.position.set(x, heightAt(x, z), z)
  g.rotation.y = h
  return g
}

let timer: ReturnType<typeof setInterval> | undefined
function refresh() {
  const [px, , pz] = playerPos.value
  let built = 0
  for (const l of candidates()) {
    const d = Math.hypot(l.x - px, l.z - pz)
    if (d < RANGE && !l.group && built < 6) {
      const g = build(l)
      if (g) {
        l.group = g
        root.add(g)
        built++ // a few per tick so it never stalls a frame
      } else l.group = new THREE.Group() // no room here: remember that
    } else if (d > RANGE + 180 && l.group) {
      root.remove(l.group)
      // only dispose geometry the lot owns; the family cars' geometries come
      // from the shared vehicle spec cache
      l.group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && !m.geometry.userData?.kkShared) m.geometry?.dispose?.()
      })
      l.group = null
    }
  }
}
onMounted(() => {
  setTimeout(refresh, 2500)
  timer = setInterval(refresh, 1500)
  if (import.meta.dev) (window as any).__kk_carparks = () => (lots ?? []).filter((l) => l.group && l.group.children.length).map((l) => [+l.x.toFixed(0), +l.z.toFixed(0)])
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <primitive :object="root" />
</template>
