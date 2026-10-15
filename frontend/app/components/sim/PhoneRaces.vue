<script setup lang="ts">
// Phone → Races: street-race routes on real Kaduna roads with leaderboards.
import { fmtNgn } from '~/utils/format'
import { useClock } from '~/composables/useTimeOfDay'
import { raceRoutes } from '~/utils/raceRoutes'

const emit = defineEmits<{ close: [] }>()
const api = useGameApi()
const routes = ref<any[]>([])
const hour = useClock()
const night = computed(() => hour.value >= 19 || hour.value < 5)
onMounted(async () => {
  // only the routes laid out in this town
  const here = new Set(raceRoutes().map((r) => r.id))
  routes.value = (await api.apiGet<any>('/races')).routes.filter((r: any) => here.has(r.id))
})
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`
function go(id: string) {
  emit('close')
  window.dispatchEvent(new CustomEvent('kk-race', { detail: { route: id } }))
}
</script>

<template>
  <div class="space-y-2 text-ink">
    <div v-if="night" class="rounded-2xl bg-ink p-3 text-xs font-bold text-amber-300">🌙 Night meet is on - the crew is waiting at the start line.</div>
    <div v-for="r in routes" :key="r.id" class="rounded-2xl bg-ink/[0.04] p-3">
      <div class="flex items-center justify-between">
        <div class="text-[14px] font-bold">{{ r.name }}</div>
        <div class="text-[11px] font-bold text-emerald-600">{{ fmtNgn(r.prize) }}</div>
      </div>
      <div class="text-[10px] text-ink/50">~{{ (r.length / 1000).toFixed(1) }} km · checkpoints on the real road</div>
      <div class="my-1.5 space-y-0.5">
        <div v-for="(b, i) in r.leaderboard.slice(0, 3)" :key="i" class="flex justify-between text-[11px]"><span>{{ ['🥇', '🥈', '🥉'][i] }} {{ b.name }}</span><span class="tabular-nums">{{ fmt(b.ms) }}</span></div>
        <div v-if="!r.leaderboard.length" class="text-[11px] text-ink/40">No times yet - be the first.</div>
      </div>
      <button class="w-full rounded-full bg-rose-600 py-2 text-xs font-bold text-white" @click="go(r.id)">Race</button>
    </div>
  </div>
</template>
