<script setup lang="ts">
// Phone → Life: the status ladder (family house → rent → own house, car
// upgrades, your own shop or restaurant) and your dream's milestones.
import { fmtKsats } from '~/utils/format'
import { useSimStore } from '~/stores/sim'

const api = useGameApi()
const ui = useUiStore()
const sim = useSimStore()
const st = ref<any>(null)
const dream = ref<any>(null)
const bizKind = ref('shop')
const bizName = ref('')
const busy = ref(false)
const carTier = useState<number>('kk_car_tier', () => 0)
const paint = ref('')
function carChanged() {
  window.dispatchEvent(new CustomEvent('kk-car-changed'))
}
async function buyCar(tier: number, name: string) {
  await act('/life/car', { tier, color: paint.value || undefined }, `Enjoy your ${name}! It's waiting in your home car park 🔑`)
  carChanged()
}
async function respray(color: string) {
  await act('/life/car/paint', { color }, 'Fresh paint ✨')
  carChanged()
}
function bringCar() {
  // your car is driven round to where you stand (a valet from the car park)
  const p = useState<[number, number, number]>('kk_player_pos').value
  const f = useState<number>('kk_player_facing').value ?? 0
  window.dispatchEvent(new CustomEvent('kk-summon-car', { detail: { x: p[0] + Math.cos(f) * 3.5, z: p[2] - Math.sin(f) * 3.5, heading: f } }))
  ui.showToast('Your car has been brought round 🔑', 'success')
}

const DREAMS: Record<string, string> = { oga: 'Oga at the top', landlord: 'Landlord', trader: 'Big trader', padi: 'Everybody’s padi', sats: 'Bitcoin pioneer' }
async function load() {
  st.value = await api.apiGet<any>('/life/status')
  carTier.value = st.value.car_tier
  dream.value = await api.apiGet<any>(`/life/dream/${sim.dream || 'oga'}`)
}
onMounted(() => load().catch((e) => ui.showToast(e.message, 'error')))

async function act(path: string, body?: any, ok?: string) {
  busy.value = true
  try {
    const r = await api.apiPost<any>(path, body)
    if (ok) ui.showToast(r.collected ? `${ok} ${fmtKsats(r.collected)}` : ok, 'success')
    await load()
    if (path.startsWith('/life/business')) window.dispatchEvent(new CustomEvent('kk-business-changed'))
  } catch (e: any) {
    ui.showToast(e.message || 'Could not do that', 'error')
  } finally {
    busy.value = false
  }
}
function goToShop() {
  const me = usePlayerStore().profile?.id
  const b = ((window as any).__kk_bizlist?.() ?? []).find((x: any) => x.owner_id === me)
  if (!b) return ui.showToast('Your shop is being set up - try again in a moment.', 'info')
  useState<boolean>('kk_phone_open').value = false
  window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'place', place: { name: b.name, to: [b.x + Math.sin(b.rot) * 8, b.z + Math.cos(b.rot) * 8] } } }))
}
const HOUSING: Record<string, string> = { family: '🏠 Family house', rent: '🏢 Your rented flat', own: '🏡 Your own house' }
</script>

<template>
  <div class="space-y-3 text-ink">
    <div v-if="!st" class="p-4 text-center text-sm text-ink/50">Loading…</div>
    <template v-else>
      <div class="rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-3 text-white">
        <div class="text-xs font-bold opacity-80">Balance</div>
        <div class="font-display text-2xl font-semibold">{{ fmtKsats(st.balance) }}</div>
        <div class="text-xs font-semibold opacity-90">{{ st.career_level.title }} · {{ st.career_level.shifts }} shifts worked</div>
      </div>

      <div v-if="dream" class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="mb-1 flex items-center justify-between text-xs font-bold"><span>✨ Dream: {{ DREAMS[dream.dream] }}</span><span>{{ dream.done }}/{{ dream.total }}</span></div>
        <div v-for="m in dream.milestones" :key="m.label" class="text-[13px]" :class="m.done ? 'text-emerald-700' : 'text-ink/55'">{{ m.done ? '✅' : '⬜' }} {{ m.label }}</div>
      </div>

      <div class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="font-display text-[15px] font-semibold">{{ HOUSING[st.housing] }}</div>
        <div v-if="st.rent_due" class="text-xs font-bold text-rose-600">Rent is due!</div>
        <div class="mt-2 flex gap-2">
          <button v-if="st.housing !== 'own'" class="flex-1 rounded-full bg-ink py-2 text-xs font-bold text-white disabled:opacity-40" :disabled="busy || (st.housing === 'rent' && !st.rent_due)" @click="act('/life/rent', undefined, 'Rent paid')">
            {{ st.housing === 'rent' ? 'Pay rent' : 'Rent a flat' }} · {{ fmtKsats(st.prices.rent) }}
          </button>
          <button v-if="st.housing !== 'own'" class="flex-1 rounded-full bg-emerald-600 py-2 text-xs font-bold text-white" :disabled="busy" @click="act('/life/house', undefined, 'Welcome to your own house!')">Buy house · {{ fmtKsats(st.prices.house) }}</button>
        </div>
      </div>

      <div class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="flex items-center justify-between">
          <div class="font-display text-[15px] font-semibold">🚗 {{ st.car_name || 'No car yet' }}</div>
          <span v-if="st.car" class="rounded-md border-2 border-emerald-700 bg-white px-1.5 text-[10px] font-extrabold tracking-wide">{{ st.car.plate }}</span>
        </div>
        <div v-if="st.car" class="mt-1 flex items-center gap-2 text-[10px] text-ink/60">
          <span class="inline-block h-3 w-3 rounded-full border border-ink/20" :style="{ background: st.car.color }" />
          {{ st.car.x != null ? 'Parked where you left it' : 'In your home car park' }}
          <button class="ml-auto rounded-full bg-sky-600 px-2 py-0.5 font-bold text-white" @click="bringCar">Bring it here</button>
        </div>
        <div class="mt-2 text-[10px] font-bold text-ink/60">{{ st.car ? 'Respray (15,000 ks)' : 'Pick a colour' }}</div>
        <div class="mt-1 flex flex-wrap gap-1.5">
          <button v-for="c in st.car_colors" :key="c" class="h-6 w-6 rounded-full border-2" :class="(st.car ? st.car.color : paint) === c ? 'border-ink' : 'border-white'" :style="{ background: c }" :disabled="busy" @click="st.car ? respray(c) : (paint = c)" />
        </div>
        <div class="mt-2 space-y-1">
          <button v-for="(c, t) in st.prices.cars" :key="t" class="flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40" :disabled="busy || Number(t) <= st.car_tier" @click="buyCar(Number(t), c.name)">
            <span>{{ c.name }}</span><span>{{ Number(t) <= st.car_tier ? 'Owned' : fmtKsats(c.price) }}</span>
          </button>
        </div>
        <div class="mt-1 text-[10px] text-ink/45">It's yours alone: only you can drive it, and you can invite friends along. Your old car is traded in at half price.</div>
      </div>

      <div class="rounded-2xl bg-ink/[0.04] p-3">
        <template v-if="st.business">
          <div class="font-display text-[15px] font-semibold">{{ st.business.kind === 'shop' ? '🏪' : '🍲' }} {{ st.business.name }}</div>
          <div class="text-xs text-ink/55">Total takings {{ fmtKsats(st.business.sales) }} · other players can buy here</div>
          <button class="mt-2 w-full rounded-full bg-emerald-600 py-2 text-xs font-bold text-white" :disabled="busy" @click="act('/life/business/collect', undefined, 'Collected')">Collect takings</button>
          <button class="mt-1 w-full rounded-full bg-ink/10 py-2 text-xs font-bold" @click="goToShop">📍 Go to my {{ st.business.kind }}</button>
        </template>
        <template v-else>
          <div class="font-display text-[15px] font-semibold">Open a business</div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button v-for="(b, k) in st.prices.businesses" :key="k" class="rounded-xl p-2 text-left text-xs" :class="bizKind === k ? 'bg-ink text-white' : 'bg-white'" @click="bizKind = String(k)">
              <div class="font-bold">{{ b.name }}</div>
              <div class="opacity-70">{{ fmtKsats(b.price) }} · ~{{ fmtKsats(b.daily) }}/day</div>
            </button>
          </div>
          <input v-model="bizName" maxlength="40" placeholder="Name it (e.g. Mama Put Deluxe)" class="mt-2 w-full rounded-xl border border-ink/10 px-3 py-2 text-xs" />
          <button class="mt-2 w-full rounded-full bg-emerald-600 py-2 text-xs font-bold text-white" :disabled="busy" @click="act('/life/business', { kind: bizKind, name: bizName }, 'Your business is open!')">Open</button>
          <div class="mt-1 text-[10px] text-ink/45">Needs a Business Admin certificate, or move out of the family house first.</div>
        </template>
      </div>
    </template>
  </div>
</template>
