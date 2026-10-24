<script setup lang="ts">
// Phone → Ward: community politics (fictional, non-partisan). Build your
// reputation, file to run for ward councillor, campaign for 30 minutes
// (rallies, posters, door-to-door, radio) and win the vote. Councillors
// fund ward projects and draw an hourly allowance.
import { fmtKsats } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
const pol = ref<any>(null)
const busy = ref(false)
const left = ref(0)
let tick: any

async function load() {
  try {
    pol.value = await api.apiGet<any>('/politics')
    left.value = pol.value.campaign?.seconds_left ?? 0
    const r = pol.value.result
    if (r) ui.showToast(r.won ? `🎉 You won the ward election ${r.you}–${r.rival}!` : `The election went to your rival (${r.rival}–${r.you}). Try again later.`, r.won ? 'success' : 'error')
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
onMounted(() => {
  load()
  tick = setInterval(() => {
    if (left.value > 0 && --left.value === 0) load() // count the votes
  }, 1000)
})
onBeforeUnmount(() => clearInterval(tick))
async function post(path: string, body: any, ok?: string) {
  busy.value = true
  try {
    const r = await api.apiPost<any>(path, body)
    if (r.office !== undefined) {
      pol.value = { ...pol.value, ...r }
      left.value = r.campaign?.seconds_left ?? 0
    }
    if (ok) ui.showToast(ok, 'success')
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
const ACT: Record<string, string> = { rally: '📣 Rally', posters: '🪧 Posters', door_to_door: '🚪 Door to door', radio: '📻 Radio' }
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const share = computed(() => {
  const c = pol.value?.campaign
  return c ? Math.round((100 * c.support) / Math.max(1, c.support + c.rival)) : 0
})
</script>

<template>
  <div v-if="pol" class="space-y-2 text-ink">
    <div class="rounded-2xl bg-gradient-to-br from-emerald-100 to-sky-100 p-3">
      <div class="text-[15px] font-bold">{{ pol.office === 'councillor' ? '🏛️ Hon. Ward Councillor' : '🏛️ Your ward' }}</div>
      <div class="text-[11px] font-semibold text-ink/60">Reputation {{ pol.reputation }} · community politics, no real parties</div>
    </div>

    <!-- in office -->
    <template v-if="pol.office === 'councillor'">
      <button class="w-full rounded-full bg-emerald-600 py-2 text-sm font-bold text-white" :disabled="busy" @click="post('/politics/allowance', {}, `Allowance paid: ${fmtKsats(pol.allowance)}`)">💼 Draw allowance · {{ fmtKsats(pol.allowance) }}/hr</button>
      <div class="text-xs font-bold">Fund a ward project</div>
      <div v-for="(p, k) in pol.projects" :key="k" class="flex items-center justify-between rounded-2xl bg-ink/[0.04] p-2.5 text-xs">
        <div><div class="font-bold">{{ p.name }}</div><div class="text-[10px] text-ink/55">+{{ p.rep }} reputation</div></div>
        <button class="rounded-full bg-sky-600 px-3 py-1 text-[11px] font-bold text-white" :disabled="busy" @click="post('/politics/project', { action: k }, `${p.name} commissioned 🎉`)">{{ fmtKsats(p.cost) }}</button>
      </div>
    </template>

    <!-- campaigning -->
    <template v-else-if="pol.campaign">
      <div class="rounded-2xl bg-amber-50 p-3 text-xs">
        <div class="flex justify-between font-bold"><span>🗳️ Election in</span><span class="tabular-nums">{{ mmss(left) }}</span></div>
        <div class="mt-2 flex justify-between text-[10px] font-semibold"><span>You · {{ pol.campaign.support }}</span><span>{{ pol.campaign.rival_name }} · ~{{ pol.campaign.rival }}</span></div>
        <div class="mt-1 flex h-2.5 overflow-hidden rounded-full bg-rose-300"><div class="h-full bg-emerald-500" :style="{ width: share + '%' }" /></div>
        <div class="mt-1 text-[10px] text-ink/55">Polls are rough - the rival's count can swing on the day.</div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button v-for="(a, k) in pol.actions" :key="k" class="rounded-2xl bg-ink/[0.05] p-2.5 text-left text-xs" :disabled="busy" @click="post('/politics/campaign', { action: k }, `${ACT[String(k)]} done: +support`)">
          <div class="font-bold">{{ ACT[String(k)] }}</div>
          <div class="text-[10px] text-ink/55">{{ a.cost ? fmtKsats(a.cost) : 'Free' }} · +{{ a.support }} · every {{ Math.round(a.cooldown_s / 60) }} min</div>
        </button>
      </div>
    </template>

    <!-- not running -->
    <template v-else>
      <div class="rounded-2xl bg-ink/[0.04] p-3 text-xs">
        <div class="font-bold">Run for ward councillor</div>
        <div class="mt-1 text-[11px] text-ink/60">Needs reputation {{ pol.min_reputation }}+ (work, run a business, help people) and a nomination fee of {{ fmtKsats(pol.fee) }}. Campaign for 30 minutes, then the ward votes.</div>
        <div class="mt-2 h-2 overflow-hidden rounded-full bg-white"><div class="h-full bg-emerald-500" :style="{ width: `${Math.min(100, (pol.reputation / pol.min_reputation) * 100)}%` }" /></div>
        <button class="mt-2 w-full rounded-full bg-emerald-600 py-2 font-bold text-white disabled:opacity-40" :disabled="busy || pol.reputation < pol.min_reputation" @click="post('/politics/declare', {}, '📣 You are on the ballot!')">Declare candidacy</button>
      </div>
    </template>
  </div>
  <div v-else class="p-4 text-center text-xs text-ink/50">Loading…</div>
</template>
