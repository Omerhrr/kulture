<script setup lang="ts">
// GrassField - real 3D grass around you: thousands of instanced tufts
// (crossed alpha cards painted with individual blades) on open ground,
// kept off roads, pavements, buildings and water. The field is rebuilt
// in a ring around the player as you move, each tuft bends in the wind
// and gets its own tint (fresh green .. dry straw) so verges read like
// real savanna instead of a flat green sheet.
import * as THREE from 'three'
import { BAKE } from '~/utils/kaduna'
import { hashDist, roadHash, waterHash, hash01 } from '~/utils/kadunaExtras'
import { hitsBuilding } from '~/utils/collision'
import { addWindSway } from '~/utils/weather'
import { getQuality } from '~/utils/quality'
import { heightAt } from '~/utils/terrain'
import { inPark } from '~/utils/parksShared'

const low = getQuality() === 'low'
const RADIUS = low ? 36 : 75
const STEP = low ? 1.7 : 1.25
const MAX = Math.ceil((Math.PI * RADIUS * RADIUS) / (STEP * STEP))

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const interior = useInterior()

// ---- blade texture: ~40 tapered blades, darker at the root
function bladeTexture() {
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const c = cv.getContext('2d')!
  let a = 1234567
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 46; i++) {
    const x = 14 + r() * (S - 28)
    const h = S * (0.45 + r() * 0.53)
    const w = 3 + r() * 4
    const lean = (r() - 0.5) * 60
    const g = c.createLinearGradient(0, S, 0, S - h)
    const v = 0.75 + r() * 0.25
    g.addColorStop(0, `rgb(${150 * v},${165 * v},${120 * v})`)
    g.addColorStop(0.6, `rgb(${225 * v},${240 * v},${200 * v})`)
    g.addColorStop(1, `rgb(${250 * v},${250 * v},${215 * v})`)
    c.fillStyle = g
    c.beginPath()
    c.moveTo(x - w, S)
    c.quadraticCurveTo(x - w * 0.4 + lean * 0.4, S - h * 0.6, x + lean, S - h)
    c.quadraticCurveTo(x + w * 0.4 + lean * 0.4, S - h * 0.6, x + w, S)
    c.closePath()
    c.fill()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
    // no mipmaps: averaged alpha would fall under alphaTest and the
    // leaves/blades would vanish a few metres away
    t.generateMipmaps = false
    t.minFilter = THREE.LinearFilter
  return t
}

// ---- tuft geometry: three crossed cards, normals pointing up so the
// blades are lit like the ground beneath (no dark backfaces)
function tuftGeometry() {
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(1.25, 0.62)
    g.translate(0, 0.31, 0)
    g.rotateY((k * Math.PI) / 3)
    parts.push(g)
  }
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let base = 0
  for (const g of parts) {
    const p = g.attributes.position
    const u = g.attributes.uv
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      uv.push(u.getX(i), u.getY(i))
    }
    const ix = g.index!
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base)
    base += p.count
    g.dispose()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const nrm = new Float32Array(pos.length)
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  geo.setIndex(idx)
  return geo
}

const geometry = tuftGeometry()
const material = new THREE.MeshLambertMaterial({
  map: typeof document !== 'undefined' ? bladeTexture() : null,
  alphaTest: 0.45,
  side: THREE.DoubleSide,
  color: '#ffffff'
})
addWindSway(material as any, 9, 0.0)

const mesh = new THREE.InstancedMesh(geometry, material, MAX)
mesh.count = 0
mesh.frustumCulled = false
mesh.receiveShadow = !low
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3)

// ---- placement mask: open ground only (4 m cells, cached)
const roadMask = new Map<number, boolean>()
const MASK = 4
function openGround(x: number, z: number): boolean {
  const ci = Math.floor(x / MASK)
  const cj = Math.floor(z / MASK)
  const key = ci * 73856093 + cj * 19349663
  let ok = roadMask.get(key)
  if (ok === undefined) {
    const cx = (ci + 0.5) * MASK
    const cz = (cj + 0.5) * MASK
    ok =
      hashDist(roadHash(), cx, cz, 24) > 13 &&
      hashDist(waterHash(), cx, cz, BAKE.river.width + 30) > BAKE.river.width * 0.5 + 14 &&
      !hitsBuilding(cx, cz, 2.2)
    roadMask.set(key, ok)
  }
  return ok
}

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const v = new THREE.Vector3()
const sc = new THREE.Vector3()
const up = new THREE.Vector3(0, 1, 0)
const fresh = new THREE.Color('#7fa04a')
const deep = new THREE.Color('#5f8a3c')
const straw = new THREE.Color('#b8a862')
const col = new THREE.Color()
let cx = 1e9
let cz = 1e9

function rebuild(px: number, pz: number) {
  cx = px
  cz = pz
  let n = 0
  const gx0 = Math.floor((px - RADIUS) / STEP)
  const gz0 = Math.floor((pz - RADIUS) / STEP)
  const cells = Math.ceil((RADIUS * 2) / STEP)
  for (let i = 0; i <= cells && n < MAX; i++) {
    for (let j = 0; j <= cells && n < MAX; j++) {
      const gi = gx0 + i
      const gj = gz0 + j
      // stable jitter per grid cell so tufts don't swim as you walk
      const x = (gi + hash01(gi, gj, 1)) * STEP
      const z = (gj + hash01(gi, gj, 2)) * STEP
      const d = Math.hypot(x - px, z - pz)
      if (d > RADIUS) continue
      // thin out toward the rim so the edge melts into the ground texture
      if (d > RADIUS * 0.6 && hash01(gi, gj, 3) < (d - RADIUS * 0.6) / (RADIUS * 0.4)) continue
      // natural clearings
      if (hash01(Math.floor(gi / 5), Math.floor(gj / 5), 9) < 0.12) continue
      if (!openGround(x, z) || inPark(x, z, 1)) continue
      const s = 0.7 + hash01(gi, gj, 4) * 0.8
      q.setFromAxisAngle(up, hash01(gi, gj, 5) * Math.PI * 2)
      sc.set(s, s * (0.8 + hash01(gi, gj, 6) * 0.7), s)
      v.set(x, -0.1 + heightAt(x, z), z)
      m4.compose(v, q, sc)
      mesh.setMatrixAt(n, m4)
      const dry = hash01(Math.floor(gi / 7), Math.floor(gj / 7), 11)
      col.copy(fresh).lerp(deep, hash01(gi, gj, 7))
      if (dry > 0.55) col.lerp(straw, Math.min(1, (dry - 0.55) * 2.2))
      mesh.setColorAt(n, col)
      n++
    }
  }
  mesh.count = n
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  mesh.visible = !interior.value.inside
  if (!mesh.visible) return
  const [px, , pz] = playerPos.value
  if (Math.hypot(px - cx, pz - cz) > RADIUS * 0.18) rebuild(px, pz)
})

if (import.meta.dev && typeof window !== 'undefined') {
  ;(window as any).__kk_grass = () => ({ count: mesh.count, max: MAX })
}

onBeforeUnmount(() => {
  geometry.dispose()
  material.map?.dispose()
  material.dispose()
  mesh.dispose()
})
</script>

<template>
  <primitive :object="mesh" />
</template>
