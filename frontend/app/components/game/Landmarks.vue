<script setup lang="ts">
// Landmarks - Lugard Hall (domed colonial assembly building near Murtala
// Square) and Kajuru Castle (the weekend-trip destination south of town),
// plus "walk up to a landmark" info prompts for every famous place.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BAKE, ws, IS_CITY } from '~/utils/kaduna'
import { hitsBuilding, addColliders } from '~/utils/collision'
import { hashDist, roadHash, houseHash } from '~/utils/kadunaExtras'
import { heightAt } from '~/utils/terrain'
import { LANDMARK_INFO } from '~/utils/landmarkInfo'
import { useInterior } from '~/composables/useControlsState'

const playerPos = useState<[number, number, number]>('kk_player_pos')
const near = useState<{ key: string; x: number; z: number } | null>('kk_landmark_near', () => null)
const interior = useInterior()
const root = new THREE.Group()

function freeSpot(x: number, z: number, r: number): [number, number] {
  for (let k = 0; k < 2500; k++) {
    const a = k * 2.399
    const d = Math.sqrt(k) * 8
    const px = x + Math.cos(a) * d
    const pz = z + Math.sin(a) * d
    if (!hitsBuilding(px, pz, r) && hashDist(roadHash(), px, pz, r + 30) > r + 6 && hashDist(houseHash(), px, pz, r + 30) > r + 8) return [px, pz]
  }
  return [x, z]
}
function colored(g: THREE.BufferGeometry, c: string) {
  const col = new THREE.Color(c)
  const n = g.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g.index ? g.toNonIndexed() : g
}
const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })

// ---- Lugard Hall: cream two-storey block, arcade of arches, green dome
function lugardHall() {
  const parts: THREE.BufferGeometry[] = []
  const add = (g: THREE.BufferGeometry, c: string, x: number, y: number, z: number, ry = 0) => {
    g.rotateY(ry)
    g.translate(x, y, z)
    parts.push(colored(g, c))
  }
  add(new THREE.BoxGeometry(42, 11, 22), '#e9dfc6', 0, 5.5, 0)
  add(new THREE.BoxGeometry(44, 0.8, 24), '#c9b994', 0, 11.2, 0)
  add(new THREE.BoxGeometry(46, 0.6, 26), '#b7a77f', 0, 0.3, 0) // plinth
  // front arcade
  for (let i = -4; i <= 4; i++) {
    add(new THREE.BoxGeometry(1.2, 7, 1.2), '#f3ecd8', i * 4.4, 3.5, 12.6)
    add(new THREE.TorusGeometry(1.6, 0.35, 6, 12, Math.PI), '#f3ecd8', i * 4.4 + 2.2, 7, 12.6)
  }
  add(new THREE.BoxGeometry(40, 1, 3), '#d9cdb0', 0, 8.6, 12.6)
  // windows
  for (let i = -4; i <= 4; i++) for (const side of [-1, 1]) add(new THREE.BoxGeometry(1.6, 2.4, 0.2), '#3b4b55', i * 4.4, 8.4, side * 11.1)
  // drum + dome + lantern
  add(new THREE.CylinderGeometry(7, 7.4, 4, 24), '#e9dfc6', 0, 13.6, 0)
  add(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), '#3f7f62', 0, 15.6, 0)
  add(new THREE.CylinderGeometry(0.9, 1.1, 2.4, 10), '#e9dfc6', 0, 23.5, 0)
  add(new THREE.ConeGeometry(1.1, 1.6, 10), '#3f7f62', 0, 25.5, 0)
  // steps + flagpoles
  for (let s = 0; s < 4; s++) add(new THREE.BoxGeometry(16 - s, 0.3, 1.2), '#cfc4a8', 0, 0.15 + s * 0.3, 15 - s * 0.9)
  for (const fx of [-18, 18]) {
    add(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), '#d8d8d8', fx, 6, 18)
    add(new THREE.BoxGeometry(2.2, 1.2, 0.05), fx < 0 ? '#118a4e' : '#ffffff', fx + 1.1, 11.2, 18)
  }
  return mergeGeometries(parts)
}

// ---- Kajuru Castle: red-brown stone keep, four round towers, battlements
function castle() {
  const parts: THREE.BufferGeometry[] = []
  const add = (g: THREE.BufferGeometry, c: string, x: number, y: number, z: number) => {
    g.translate(x, y, z)
    parts.push(colored(g, c))
  }
  const stone = '#8c5a3c'
  const dark = '#6d4430'
  add(new THREE.CylinderGeometry(26, 30, 6, 9), '#7d7464', 0, 3, 0) // the rock
  add(new THREE.BoxGeometry(24, 14, 24), stone, 0, 13, 0)
  for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12]] as const) {
    add(new THREE.CylinderGeometry(3.6, 3.9, 20, 14), stone, x, 16, z)
    add(new THREE.ConeGeometry(4.4, 6, 14), '#5b2e22', x, 29, z)
  }
  // battlements
  for (let i = -5; i <= 5; i++) {
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(1.2, 1.6, 1.2), dark, i * 2.1, 20.8, s * 11.6)
      add(new THREE.BoxGeometry(1.2, 1.6, 1.2), dark, s * 11.6, 20.8, i * 2.1)
    }
  }
  // gate + windows
  add(new THREE.BoxGeometry(5, 7, 0.6), '#2b1d16', 0, 9.5, 12.1)
  for (const x of [-7, 7]) add(new THREE.BoxGeometry(1.4, 2.6, 0.3), '#2b1d16', x, 15, 12.1)
  // central tower
  add(new THREE.CylinderGeometry(4.2, 4.2, 10, 14), stone, 0, 25, 0)
  add(new THREE.ConeGeometry(5, 7, 14), '#5b2e22', 0, 33.5, 0)
  return mergeGeometries(parts)
}

const built: Array<{ key: string; x: number; z: number }> = []
onMounted(() => {
  if (!IS_CITY) return void ((window as any).__kk_landmarks = () => [])
  // Lugard Hall sits just north-east of Murtala Square
  const [lx, lz] = freeSpot(ws(34), ws(-26), 28)
  const hall = new THREE.Mesh(lugardHall(), mat)
  hall.position.set(lx, heightAt(lx, lz), lz)
  hall.castShadow = hall.receiveShadow = true
  root.add(hall)
  addColliders([{ x: lx, z: lz, w: 46, d: 26 }] as any)
  built.push({ key: 'lugard_hall', x: lx, z: lz })
  // Kajuru Castle beyond the Kajuru road sign (the weekend trip)
  const sign = BAKE.landmarks.find((l) => l.key === 'kajuru_sign')
  const [cx, cz] = freeSpot((sign?.x ?? ws(250)) + 70, (sign?.z ?? ws(1120)) + 70, 34)
  const ca = new THREE.Mesh(castle(), mat)
  ca.position.set(cx, heightAt(cx, cz), cz)
  ca.castShadow = ca.receiveShadow = true
  root.add(ca)
  addColliders([{ x: cx, z: cz, w: 34, d: 34 }] as any)
  built.push({ key: 'kajuru_castle', x: cx, z: cz })
  ;(window as any).__kk_lmdbg = () => root.children.map((c) => { const m = c as THREE.Mesh; m.geometry.computeBoundingBox(); let p: any = c; let chain = 0; while (p.parent) { p = p.parent; chain++ } return { pos: c.position.toArray(), bb: m.geometry.boundingBox, chain, top: p.type, vis: c.visible, rootVis: root.visible } })
  ;(window as any).__kk_landmarks = () => built.map((b, i) => ({ ...b, mesh: !!(root.children[i] as THREE.Mesh)?.geometry?.attributes?.position?.count, y: root.children[i]?.position.y }))
})

// nearest landmark with an info card (checked twice a second)
let acc = 0
const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  const now = performance.now()
  if (now - acc < 500) return
  acc = now
  if (interior.value.inside) return void (near.value = null)
  const [px, , pz] = playerPos.value
  let best: { key: string; x: number; z: number } | null = null
  let bd = Infinity
  const cand = [...BAKE.landmarks.map((l) => ({ key: l.key, x: l.x, z: l.z, r: Math.max(l.kw, l.kd) / 2 + 30 })), ...built.map((b) => ({ ...b, r: 50 })), ...BAKE.bridges.map((b) => ({ key: 'bridge', x: b.x, z: b.z, r: 40 }))]
  for (const c of cand) {
    if (!LANDMARK_INFO[c.key]) continue
    const d = Math.hypot(c.x - px, c.z - pz)
    if (d < c.r && d < bd) (bd = d), (best = { key: c.key, x: c.x, z: c.z })
  }
  if (best?.key !== near.value?.key) near.value = best
})
</script>

<template>
  <primitive :object="root" />
</template>
