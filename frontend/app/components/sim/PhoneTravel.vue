<script setup lang="ts">
// Phone → Travel: shared-taxi trips between the towns of Kaduna State on
// the real highways. Pay the fare, ride, arrive at that town's market.
import { fmtKsats } from '~/utils/format'
import { REGION_ID, regionById } from '~/utils/regions'

const api = useGameApi()
const ui = useUiStore()
const towns = ref<any[]>([])
const going = ref<any>(null)
onMounted(async () => {
  try {
    towns.value = (await api.apiGet<any>('/world/towns')).towns
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
})
async function go(t: any) {
  try {
    const r = await api.apiPost<any>('/world/travel', { region: t.id })
    going.value = { ...t, ...r }
    try {
      localStorage.setItem('kk_region', t.id)
    } catch {}
    // the ride plays as the HighwayTrip scene; it reloads into the new town
  } catch (e: any) {
    ui.showToast(e.message || 'Could not travel', 'error')
  }
}
function arrive() {
  window.location.href = '/game'
}
const here = regionById(REGION_ID)
</script>

<template>
  <div class="space-y-2 text-ink">
    <div class="rounded-2xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">📍 You are in {{ here.name }} · {{ here.lga }}</div>
    <div v-for="t in towns" :key="t.id" class="rounded-2xl p-3" :class="t.here ? 'bg-ink/[0.03] opacity-60' : 'bg-ink/[0.05]'">
      <div class="flex items-center justify-between">
        <div class="text-[14px] font-bold">{{ t.name }}</div>
        <div class="text-[11px] font-bold text-emerald-700">{{ t.here ? 'Here' : fmtKsats(t.fare_from_here) }}</div>
      </div>
      <div class="text-[10px] text-ink/55">{{ regionById(t.id).blurb }}</div>
      <div v-if="!t.here" class="mt-1 flex items-center justify-between">
        <span class="text-[10px] text-ink/45">{{ t.km ? `${t.km} km · ${t.highway}` : 'State capital' }}</span>
        <button class="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white" :disabled="!!going" @click="go(t)">🚕 Go</button>
      </div>
    </div>
    <p class="text-[10px] text-ink/45">Kaduna is the full OpenStreetMap city. The other towns are drawn from public geography (real centres, highways and landmarks) with generated streets.</p>
    <teleport to="body">
      <HighwayTrip v-if="going" :to="going.name" :highway="going.highway" :fare="fmtKsats(going.fare)" @done="arrive" />
    </teleport>
  </div>
</template>
