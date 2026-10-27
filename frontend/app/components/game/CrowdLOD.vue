<script setup lang="ts">
import { perf } from '~/utils/quality'
// CrowdLOD - the pedestrians closest to you are drawn with the full
// skinned human rig (hands, fingers, cloth, real gait); everyone further
// away stays in the cheap instanced crowd. Swaps are made a few times a
// second; the instanced copy of a high-detail ped is hidden (ped.hd).
import * as THREE from 'three'
import { crowd } from '~/utils/crowdShared'
import { lookFor, type Look } from '~/utils/wardrobe'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const interior = useInterior()
const MAX = perf().lodPeople
const RANGE = perf().lodRange

interface Slot {
  id: number
  female: boolean
  kid: boolean
  look: { shirt: string; trouser: string; skin: string; hair: string }
  kaftan: boolean
  real: Look
}
const slots = ref<Slot[]>([])
const groups = new Map<number, THREE.Group>()
const setRef = (id: number) => (el: any) => {
  const o = el?.instance ?? el?.value ?? el
  if (o && o.isObject3D) groups.set(id, o)
  else groups.delete(id)
}
const modes = reactive<Record<number, 'walk' | 'idle' | 'sit'>>({})
const seats = reactive<Record<number, number>>({})
const last = new Map<number, [number, number]>()

let pick = 0
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  const peds = crowd.peds
  if (!peds.length) return
  pick += delta || 0.016
  if (pick > 0.35) {
    pick = 0
    const [px, , pz] = playerPos.value
    const near: Array<[number, any]> = []
    if (!interior.value.inside) {
      for (const p of peds) {
        if (p.sleep || (p.knock ?? -1) >= 0) continue
        const d = Math.hypot(p.x - px, p.z - pz)
        if (d < RANGE) near.push([d, p])
      }
    }
    near.sort((a, b) => a[0] - b[0])
    const chosen = new Set(near.slice(0, MAX).map(([, p]) => p.id))
    for (const p of peds) p.hd = chosen.has(p.id)
    const cur = new Set(slots.value.map((s) => s.id))
    if (chosen.size !== cur.size || [...chosen].some((id) => !cur.has(id))) {
      slots.value = near.slice(0, MAX).map(([, p]) => ({
        id: p.id,
        female: !!p.female,
        kid: !!p.kid,
        look: p.look ?? { shirt: '#3f6fae', trouser: '#2b3440', skin: '#7a4e33', hair: '#141114' },
        kaftan: !p.female && p.id % 3 !== 0,
        real: lookFor(p.id, !!p.female)
      }))
    }
  }
  // follow the simulated peds every frame
  const dt = Math.max(delta || 0.016, 1e-3)
  for (const s of slots.value) {
    const p = peds.find((q: any) => q.id === s.id)
    const g = groups.get(s.id)
    if (!p || !g) continue
    const prev = last.get(s.id)
    const speed = prev ? Math.hypot(p.x - prev[0], p.z - prev[1]) / dt : 0
    last.set(s.id, [p.x, p.z])
    g.position.set(p.x, 0, p.z)
    g.rotation.y = p.heading
    const m = p.sit ? 'sit' : speed > 0.4 ? 'walk' : 'idle'
    if (modes[s.id] !== m) modes[s.id] = m
    const sh = p.sit ? (p.seatH ?? 1.5) : 0.45
    if (seats[s.id] !== sh) seats[s.id] = sh
  }
})
onBeforeUnmount(() => {
  for (const p of crowd.peds) p.hd = false
})
</script>

<template>
  <TresGroup>
    <TresGroup v-for="s in slots" :key="s.id" :ref="setRef(s.id)">
      <CharacterAvatar
        real
        :shirt="s.real.top"
        :trouser="s.real.bottom"
        :skin="s.real.skin"
        :hair-color="s.real.hair ?? s.look.hair"
        :female="s.female"
        :hijab="false"
        :outfit="s.female ? 'dress' : s.kaftan ? 'kaftan' : 'shirt'"
        :kufi="false"
        :hair-style="s.female ? 'braids' : s.kaftan ? 'cap' : s.id % 2 ? 'afro' : 'bald'"
        :beard="!s.female && !s.kid && s.id % 3 === 1"
        :scale="s.kid ? 0.72 : 1"
        :phase="s.id * 0.37"
        :mode="modes[s.id] ?? 'walk'"
        :gait-speed="10"
        :seat="seats[s.id] ?? 0.45"
      />
    </TresGroup>
  </TresGroup>
</template>
