<script setup lang="ts">
// AdScreens - the digital faces of every roadside billboard. Live ads from
// the server take turns (15 s each); empty boards sell themselves with a
// "Your ad here" house ad. Walking near a billboard offers "View ads".
import * as THREE from 'three'
import { BILLBOARDS } from '~/utils/billboards'
import { adTexture, houseAds, type AdContent } from '~/utils/adArt'
import { useAdsStore } from '~/stores/ads'
import { useInterior, useRide } from '~/composables/useControlsState'
import { useWorkStore } from '~/stores/work'

const ads = useAdsStore()
const work = useWorkStore()
const interior = useInterior()
const ride = useRide()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const near = useState<string | null>('kk_billboard_near', () => null)

const root = new THREE.Group()
const geo = new THREE.PlaneGeometry(6.62, 3.06)
interface Screen {
  id: string
  mat: THREE.MeshBasicMaterial
  idx: number
}
let screens: Screen[] = []
let built = 0

function build() {
  root.clear()
  screens = []
  for (const b of BILLBOARDS) {
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false })
    const nx = Math.sin(b.a)
    const nz = Math.cos(b.a)
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(b.x + nx * 0.135 * side, 7.8, b.z + nz * 0.135 * side)
      m.rotation.y = side > 0 ? b.a : b.a + Math.PI
      root.add(m)
    }
    screens.push({ id: b.id, mat, idx: Math.floor(Math.random() * 3) })
  }
  built = BILLBOARDS.length
  paint()
}

function contentFor(id: string): Array<{ key: string; ad: AdContent }> {
  const live = ads.boards[id] ?? []
  if (live.length) return live.map((a) => ({ key: `ad:${a.id}`, ad: { brand: a.brand, headline: a.headline, subline: a.subline, cta: a.cta, domain: a.domain, theme: a.theme } }))
  return houseAds(ads.price).map((ad, i) => ({ key: `house:${i}:${ads.price}`, ad }))
}
function paint() {
  for (const s of screens) {
    const list = contentFor(s.id)
    const pick = list[s.idx % list.length]
    s.mat.map = adTexture(pick.key, pick.ad)
    s.mat.needsUpdate = true
  }
}
watch(() => ads.version, paint)

let rot = 0
let scan = 0
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  if (BILLBOARDS.length && built !== BILLBOARDS.length) build()
  const dt = delta || 0.016
  rot += dt
  if (rot > 15) {
    rot = 0
    for (const s of screens) s.idx++
    paint()
  }
  scan += dt
  if (scan > 0.3) {
    scan = 0
    if (interior.value.inside || ride.value.active || work.commute?.active) {
      near.value = null
      return
    }
    const [px, , pz] = playerPos.value
    let best: string | null = null
    let bd = 16
    for (const b of BILLBOARDS) {
      const d = Math.hypot(b.x - px, b.z - pz)
      if (d < bd) (bd = d), (best = b.id)
    }
    near.value = best
  }
})
onMounted(() => ads.refresh().catch(() => {}))
if (import.meta.dev && typeof window !== 'undefined') (window as any).__kk_billboards = () => BILLBOARDS.map((b) => ({ id: b.id, x: b.x, z: b.z, road: b.road, area: b.area }))
</script>

<template>
  <primitive :object="root" />
</template>
