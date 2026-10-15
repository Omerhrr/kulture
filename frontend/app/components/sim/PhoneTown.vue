<script setup lang="ts">
// Phone → Town: what's on in each town of Kaduna State. Zaria polo (with a
// small friendly wager), the Kafanchan train ride, the Kagoro Hills hike and
// Kachia market day. Each plays out as a short scene; travel to do them.
import { fmtNgn } from '~/utils/format'
import { REGION_ID, regionById } from '~/utils/regions'
import { useSimStore } from '~/stores/sim'

const api = useGameApi()
const ui = useUiStore()
const sim = useSimStore()
const acts = ref<Record<string, any>>({})
const bet = ref<string | null>(null)
const scene = ref<{ icon: string; title: string; lines: string[]; i: number; end?: string } | null>(null)
const busy = ref(false)
onMounted(async () => {
  try {
    acts.value = (await api.apiGet<any>('/activities')).activities
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
})
const ICON: Record<string, string> = { polo: '🐎', train_ride: '🚂', kagoro_hike: '⛰️', market_day: '🧺' }
const BLURB: Record<string, string> = {
  polo: 'Zaria is Nigeria’s polo heartland. Watch the Emir’s cup on the polo ground.',
  train_ride: 'Ride the line out of Kafanchan Junction past farms and the Kagoro hills.',
  kagoro_hike: 'Climb the granite Kagoro Hills for the view. Free - builds fitness.',
  market_day: 'Weekly market day: yams, grains, ginger and bargains from across the LGA.'
}
const SCRIPT: Record<string, string[]> = {
  polo: ['The riders gallop onto the ground…', 'Zazzau Riders strike first! 🏇', 'Kano Chargers answer before the chukka ends.', 'Final chukka - the crowd is on its feet!'],
  train_ride: ['All aboard at Kafanchan Junction 🚉', 'Green farms roll by the window…', 'The Kagoro hills rise on your left ⛰️', 'Back at the station. What a ride!'],
  kagoro_hike: ['Lacing up at the foot of the hills…', 'The path gets steep - keep going! 💪', 'Rest by a rock pool 💧', 'The summit! All of Jema’a below you 🌄'],
  market_day: ['The market is packed from first light…', '“Yam! Fresh yam!” 🍠', 'You haggle a good price on ginger and grains', 'Bags full, purse not too empty 🧺']
}
async function go(id: string) {
  busy.value = true
  try {
    const r = await api.apiPost<any>('/activities/do', { id, result: id === 'polo' && bet.value ? { bet: bet.value } : null })
    let end = `${r.name} ✓`
    if (r.winner) end = `${r.winner} win! ${r.won ? `Your wager pays ${fmtNgn(r.won)} 🎉` : 'Your team lost the wager.'}`
    else if (id === 'polo') end = 'What a match! 🏆'
    if (id === 'kagoro_hike') end = 'Fitness up 💪 - you can sprint further now.'
    if (id === 'market_day') {
      sim.needs.hunger = Math.min(100, sim.needs.hunger + 35)
      sim.needs.fun = Math.min(100, sim.needs.fun + 15)
      sim.save()
      end = r.bargain ?? end
    } else {
      sim.needs.fun = Math.min(100, sim.needs.fun + 25)
      sim.save()
    }
    scene.value = { icon: ICON[id]!, title: r.name, lines: SCRIPT[id]!, i: 0, end }
    const t = setInterval(() => {
      if (!scene.value) return clearInterval(t)
      if (scene.value.i < scene.value.lines.length) scene.value.i++
      else clearInterval(t)
    }, 1300)
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
const goTravel = useState<string | null>('kk_phone_goto', () => null)
</script>

<template>
  <div class="space-y-2 text-ink">
    <div class="rounded-2xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">📍 {{ regionById(REGION_ID).name }} · what's on around Kaduna State</div>
    <div v-for="(a, id) in acts" :key="id" class="rounded-2xl p-3" :class="String(a.town) === REGION_ID ? 'bg-amber-50' : 'bg-ink/[0.04]'">
      <div class="flex items-center justify-between">
        <div class="text-[14px] font-bold">{{ ICON[String(id)] }} {{ a.name }}</div>
        <div class="text-[11px] font-bold text-emerald-700">{{ a.cost ? fmtNgn(a.cost) : 'Free' }}</div>
      </div>
      <div class="text-[10px] text-ink/55">{{ BLURB[String(id)] }}</div>
      <template v-if="String(a.town) === REGION_ID">
        <div v-if="String(id) === 'polo'" class="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] font-bold">
          Wager ₦1,000 on:
          <button v-for="t in ['Zazzau Riders', 'Kano Chargers']" :key="t" class="rounded-full px-2 py-0.5" :class="bet === t ? 'bg-amber-500 text-white' : 'bg-white'" @click="bet = bet === t ? null : t">{{ t }}</button>
        </div>
        <button class="mt-2 w-full rounded-full bg-amber-500 py-1.5 text-xs font-bold text-white" :disabled="busy" @click="go(String(id))">Go</button>
      </template>
      <button v-else class="mt-1 text-[10px] font-bold text-sky-700" @click="goTravel = 'travel'">🚕 In {{ regionById(a.town).name }} - travel there ›</button>
    </div>

    <teleport to="body">
      <div v-if="scene" class="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-gradient-to-b from-[#7cc0e8] to-[#e9c27a] p-6 text-center text-ink" @click="scene.i >= scene.lines.length && (scene = null)">
        <div class="animate-bounce text-6xl">{{ scene.icon }}</div>
        <div class="mt-2 font-display text-2xl font-semibold">{{ scene.title }}</div>
        <div class="mt-4 min-h-[5rem] space-y-1 text-sm font-semibold">
          <div v-for="(l, i) in scene.lines.slice(0, scene.i + 1)" :key="i" class="transition">{{ l }}</div>
        </div>
        <div v-if="scene.i >= scene.lines.length" class="mt-3 rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold">{{ scene.end }}</div>
        <div v-if="scene.i >= scene.lines.length" class="mt-4 text-xs text-ink/60">Tap to continue</div>
      </div>
    </teleport>
  </div>
</template>
