<script setup lang="ts">
// Phone → Family & Health: your spouse and children (feed them, play, pay
// school fees) plus your body: health, fitness → stamina, sickness and the
// hospital. The gym (Kaduna) and the Kagoro hike (Kafanchan) raise fitness.
import { fmtNgn } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
const fam = ref<any>(null)
const hp = ref<any>(null)
const name = ref('')
const gender = ref<'boy' | 'girl'>('girl')
const busy = ref(false)

async function load() {
  try {
    ;[fam.value, hp.value] = await Promise.all([api.apiGet<any>('/family'), api.apiGet<any>('/health/me')])
    if (hp.value?.news) ui.showToast(`🤒 You've come down with ${hp.value.news}. Visit the hospital.`, 'error')
    syncStamina()
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
onMounted(load)
// stamina scales how long you can sprint in the world (PlayerAvatar reads it)
function syncStamina() {
  if (!hp.value) return
  const w = window as any
  w.__kk_stamina = hp.value.sick ? Math.max(30, hp.value.stamina - 30) : hp.value.stamina
}
async function run(fn: () => Promise<any>, ok?: string) {
  busy.value = true
  try {
    await fn()
    if (ok) ui.showToast(ok, 'success')
    await load()
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
const baby = () => run(() => api.apiPost('/family/baby', { name: name.value.trim(), gender: gender.value }), `👶 Welcome, ${name.value.trim()}!`).then(() => (name.value = ''))
const care = (id: string, action: string, ok: string) => run(() => api.apiPost('/family/care', { child_id: id, action }), ok)
const hospital = () => run(() => api.apiPost('/health/hospital'), '🏥 The doctor sorted you out')
const bar = (v: number) => (v > 60 ? 'bg-emerald-500' : v > 30 ? 'bg-amber-400' : 'bg-rose-500')
</script>

<template>
  <div v-if="fam && hp" class="space-y-2 text-ink">
    <!-- health -->
    <div class="rounded-2xl bg-rose-50 p-3">
      <div class="mb-1 flex items-center justify-between text-xs font-bold text-rose-800">
        <span>❤️ Health {{ hp.health }} · 💪 Fitness {{ hp.fitness }}</span>
        <span>Stamina {{ hp.stamina }}</span>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-white"><div class="h-full" :class="bar(hp.health)" :style="{ width: hp.health + '%' }" /></div>
      <div v-if="hp.sick" class="mt-2 text-[11px] font-semibold text-rose-700">🤒 You have {{ hp.sick }}. Work pays half until you're treated.</div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[10px] text-ink/55">Gym sessions and the Kagoro hike build fitness → longer sprints.</span>
        <button class="shrink-0 rounded-full bg-rose-600 px-3 py-1 text-[11px] font-bold text-white" :disabled="busy" @click="hospital">🏥 {{ hp.sick ? 'Treat' : 'Check-up' }} · {{ fmtNgn(hp.hospital_cost) }}</button>
      </div>
    </div>

    <!-- family -->
    <div class="rounded-2xl bg-amber-50 p-3 text-xs">
      <div class="font-bold text-amber-800">👨‍👩‍👧 {{ fam.spouse ? `Married to ${fam.spouse}` : 'Not married yet' }}</div>
      <div v-if="!fam.spouse" class="mt-1 text-[11px] text-ink/60">Meet someone on Connect, date, propose and throw the owambe - then you can start a family.</div>
    </div>
    <div v-for="c in fam.children" :key="c.id" class="rounded-2xl bg-ink/[0.04] p-3">
      <div class="flex items-center justify-between text-[13px] font-bold">
        <span>{{ c.gender === 'boy' ? '👦' : '👧' }} {{ c.name }}</span>
        <span class="text-[10px] font-semibold text-ink/50">{{ c.stage }} · {{ c.age_days }} days</span>
      </div>
      <div class="mt-1 grid grid-cols-2 gap-2 text-[10px]">
        <div>🍲 Fed <div class="h-1.5 overflow-hidden rounded-full bg-white"><div class="h-full" :class="bar(c.hunger)" :style="{ width: c.hunger + '%' }" /></div></div>
        <div>😊 Happy <div class="h-1.5 overflow-hidden rounded-full bg-white"><div class="h-full" :class="bar(c.happiness)" :style="{ width: c.happiness + '%' }" /></div></div>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <button class="rounded-full bg-white px-2 py-1 text-[10px] font-bold" :disabled="busy" @click="care(c.id, 'feed', `${c.name} ate well`)">🍲 Feed · {{ fmtNgn(fam.prices.feed) }}</button>
        <button class="rounded-full bg-white px-2 py-1 text-[10px] font-bold" :disabled="busy" @click="care(c.id, 'play', `You played with ${c.name}`)">⚽ Play</button>
        <button v-if="!c.schooling && c.stage !== 'baby'" class="rounded-full bg-violet-600 px-2 py-1 text-[10px] font-bold text-white" :disabled="busy" @click="care(c.id, 'school', `${c.name} is enrolled`)">🎒 School · {{ fmtNgn(fam.prices.school) }}</button>
        <span v-else-if="c.schooling" class="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-bold text-violet-700">🎒 In school</span>
      </div>
    </div>
    <form v-if="fam.spouse && fam.children.length < fam.max_children" class="space-y-1.5 rounded-2xl bg-sky-50 p-3" @submit.prevent="baby">
      <div class="text-xs font-bold text-sky-800">👶 Have a baby · {{ fmtNgn(fam.prices.baby) }} (naming ceremony & care)</div>
      <div class="flex gap-1">
        <input v-model="name" maxlength="40" placeholder="Name (e.g. Aisha)" class="min-w-0 flex-1 rounded-full border border-ink/10 px-3 py-1 text-xs" />
        <button type="button" class="rounded-full px-2 text-[11px] font-bold" :class="gender === 'girl' ? 'bg-pink-500 text-white' : 'bg-white'" @click="gender = 'girl'">👧</button>
        <button type="button" class="rounded-full px-2 text-[11px] font-bold" :class="gender === 'boy' ? 'bg-sky-600 text-white' : 'bg-white'" @click="gender = 'boy'">👦</button>
      </div>
      <button class="w-full rounded-full bg-sky-600 py-1.5 text-xs font-bold text-white" :disabled="busy || name.trim().length < 2">Welcome the baby</button>
    </form>
  </div>
  <div v-else class="p-4 text-center text-xs text-ink/50">Loading…</div>
</template>
