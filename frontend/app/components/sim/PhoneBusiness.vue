<script setup lang="ts">
// Phone → Business: run the shop you own. Restock wholesale, set prices
// (cheaper sells more, dearer earns more per sale), hire staff (they sell
// more but cost wages), collect takings and grow: shop → supermarket → mall.
import { fmtNgn } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
const biz = ref<any>(null)
const none = ref(false)
const report = ref<any>(null)
const price = ref(100)
const busy = ref(false)

async function load() {
  try {
    biz.value = await api.apiGet<any>('/business')
    price.value = biz.value.price_pct
  } catch (e: any) {
    if (/business/i.test(e.message)) none.value = true
    else ui.showToast(e.message, 'error')
  }
}
onMounted(load)
async function act(action: string, value = 0, ok?: string) {
  busy.value = true
  try {
    biz.value = await api.apiPost<any>('/business/action', { action, value })
    price.value = biz.value.price_pct
    if (ok) ui.showToast(ok, 'success')
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
async function collect() {
  busy.value = true
  try {
    const r = await api.apiPost<any>('/business/collect')
    report.value = r.report ?? r
    await load()
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
const demandHint = computed(() => (price.value < 90 ? 'Bargain prices: more customers, thinner margin' : price.value > 115 ? 'Pricey: fewer customers, bigger margin' : 'Fair price: steady customers'))
const room = computed(() => (biz.value ? biz.value.max_stock - biz.value.stock : 0))
</script>

<template>
  <div class="space-y-2 text-ink">
    <div v-if="none" class="rounded-2xl bg-amber-50 p-4 text-center text-xs">
      <div class="text-3xl">🏪</div>
      <div class="mt-1 font-bold">You don't own a business yet</div>
      <div class="text-ink/60">Open one from Phone → Life (provision shop or restaurant), then manage it here.</div>
    </div>
    <template v-else-if="biz">
      <div class="rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 p-3">
        <div class="text-[15px] font-bold">{{ biz.name }}</div>
        <div class="text-[11px] font-semibold text-amber-800">Level {{ biz.level }} · {{ biz.level_name }} · {{ fmtNgn(biz.sales) }} earned so far</div>
      </div>

      <!-- stock -->
      <div class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="mb-1 flex justify-between text-xs font-bold"><span>📦 Stock</span><span>{{ biz.stock }} / {{ biz.max_stock }}</span></div>
        <div class="h-2 overflow-hidden rounded-full bg-white"><div class="h-full" :class="biz.stock < 15 ? 'bg-rose-500' : 'bg-emerald-500'" :style="{ width: `${(biz.stock / biz.max_stock) * 100}%` }" /></div>
        <div v-if="biz.stock < 15" class="mt-1 text-[10px] font-semibold text-rose-600">Shelves nearly empty - customers walk away with no stock.</div>
        <div class="mt-2 flex flex-wrap gap-1">
          <button v-for="n in [20, 50, 100]" :key="n" class="rounded-full bg-white px-2 py-1 text-[10px] font-bold disabled:opacity-40" :disabled="busy || room <= 0" @click="act('restock', Math.min(n, room), `Restocked ${Math.min(n, room)} units`)">+{{ Math.min(n, room) }} · {{ fmtNgn(Math.min(n, room) * biz.unit_cost) }}</button>
        </div>
      </div>

      <!-- price -->
      <div class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="flex justify-between text-xs font-bold"><span>🏷️ Prices</span><span>{{ price }}%</span></div>
        <input v-model.number="price" type="range" min="70" max="150" step="5" class="w-full accent-amber-600" @change="act('price', price)" />
        <div class="text-[10px] text-ink/55">{{ demandHint }}</div>
      </div>

      <!-- staff -->
      <div class="flex items-center justify-between rounded-2xl bg-ink/[0.04] p-3 text-xs">
        <div>
          <div class="font-bold">🧑‍💼 Staff {{ biz.staff }} / {{ biz.max_staff }}</div>
          <div class="text-[10px] text-ink/55">Each sells more, costs {{ fmtNgn(biz.staff_wage) }}/day</div>
        </div>
        <div class="flex gap-1">
          <button class="rounded-full bg-white px-2.5 py-1 font-bold" :disabled="busy || !biz.staff" @click="act('fire')">−</button>
          <button class="rounded-full bg-emerald-600 px-2.5 py-1 font-bold text-white" :disabled="busy || biz.staff >= biz.max_staff" @click="act('hire', 0, 'New staff hired')">Hire</button>
        </div>
      </div>

      <button class="w-full rounded-full bg-emerald-600 py-2 text-sm font-bold text-white" :disabled="busy" @click="collect">💰 Collect takings</button>
      <div v-if="report" class="rounded-2xl bg-emerald-50 p-3 text-[11px]">
        <div class="font-bold text-emerald-800">Report · {{ report.days }} day(s)</div>
        <div class="flex justify-between"><span>Units sold</span><span>{{ report.units }}</span></div>
        <div class="flex justify-between"><span>Sales</span><span>{{ fmtNgn(report.gross) }}</span></div>
        <div class="flex justify-between"><span>Wages</span><span>−{{ fmtNgn(report.wages) }}</span></div>
        <div class="flex justify-between font-bold"><span>Profit</span><span>{{ fmtNgn(report.net) }}</span></div>
      </div>

      <div v-if="biz.next_level" class="rounded-2xl bg-violet-50 p-3 text-xs">
        <div class="font-bold text-violet-800">⬆️ Grow into a {{ biz.next_level.name }}</div>
        <div class="text-[10px] text-ink/55">Bigger store room, room for more staff, more reputation.</div>
        <button class="mt-2 w-full rounded-full bg-violet-600 py-1.5 font-bold text-white" :disabled="busy" @click="act('upgrade', 0, `Now a ${biz.next_level.name}! 🎉`)">Upgrade · {{ fmtNgn(biz.next_level.price) }}</button>
      </div>
      <div v-else class="rounded-2xl bg-violet-50 p-3 text-center text-xs font-bold text-violet-800">🏆 Top of the market - a {{ biz.level_name }}</div>
    </template>
  </div>
</template>
