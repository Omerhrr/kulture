<script setup lang="ts">
import { useHomeStore } from '~/stores/home'
// Dock - the four big verbs of the life sim, always one tap away.
import { fireKkEvent, useMapOpen, useInterior, useCityMap } from '~/composables/useControlsState'

const ui = useUiStore()
const world = useWorldStore()
const payments = usePaymentsStore()
const mapOpen = useMapOpen()
const cityMap = useCityMap()
const interior = useInterior()
const phoneOpen = useState<boolean>('kk_phone_open', () => false)

const home = useHomeStore()
async function buy() {
  // in your own home, Buy is build mode (furniture); outside it's the shop
  if (interior.value.inside && interior.value.name === 'Your home') {
    home.build = !home.build
    return
  }
  // the nearest thing to "Buy mode": Musa's store catalogue, paid in sats
  const shop = world.entities.find((e) => e.code === 'musa_shop' && e.business_id)
  if (!shop?.business_id) return ui.showToast('No shop open right now', 'info')
  try {
    await payments.openForBusiness(shop.business_id)
    ui.openPanel = 'shop'
  } catch (e: any) {
    ui.showToast(e.message || 'Could not open the shop', 'error')
  }
}
const items = computed(() => [
  { id: 'home', icon: '🏠', label: 'Home', on: interior.value.inside, run: () => fireKkEvent('kk-go-home') },
  { id: 'buy', icon: '🛋️', label: 'Buy', on: ui.openPanel === 'shop' || home.build, run: buy },
  { id: 'fund', icon: '⚡', label: 'Fund', on: fundOpen.value, run: () => (payments.dialogOpen ? null : (fundOpen.value = !fundOpen.value)) },
  { id: 'map', icon: '🗺️', label: 'Map', on: cityMap.value.active || mapOpen.value, run: () => ((mapOpen.value = false), (cityMap.value.active = !cityMap.value.active)) },
  { id: 'phone', icon: '📱', label: 'Phone', on: phoneOpen.value, run: () => (phoneOpen.value = !phoneOpen.value) }
])

// deposit sheet: Lightning sats -> k-sats at 1 sat = 1,000 k-sats
const fundOpen = ref(false)
const SATS_PRESETS = [1_000, 5_000, 25_000]
function fund(sats: number) {
  fundOpen.value = false
  payments.startDeposit(sats)
}
</script>

<template>
  <div class="contents">
  <nav data-tour="dock" class="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-[1.6rem] border border-ink/10 bg-white/90 p-1.5 shadow-xl shadow-ink/10 backdrop-blur-md" aria-label="Main">
    <button
      v-for="it in items"
      :key="it.id"
      :data-tour="'dock-' + it.id"
      class="flex w-[4.6rem] flex-col items-center gap-0.5 rounded-[1.2rem] py-2 text-[12px] font-bold transition-colors sm:w-24"
      :class="it.on ? 'bg-ink text-white' : 'text-ink/70 hover:bg-ink/5 hover:text-ink'"
      :aria-pressed="it.on"
      @click="it.run()"
    >
      <span class="text-xl leading-none" aria-hidden="true">{{ it.icon }}</span>{{ it.label }}
    </button>
  </nav>
  <div v-if="fundOpen" class="pointer-events-auto absolute bottom-24 left-1/2 z-20 w-[min(340px,92vw)] -translate-x-1/2 rounded-2xl border border-ink/10 bg-white p-3 shadow-xl shadow-ink/10">
    <div class="flex items-center justify-between">
      <div class="font-bold">
        <div class="text-[14px]">⚡ Fund with Lightning</div>
        <div class="text-[10px] font-semibold text-ink/55">1 sat = 1,000 k-sats · scan the QR after you pick</div>
      </div>
      <button class="rounded-full bg-ink/5 px-2 py-0.5 text-sm font-bold" aria-label="Close deposit sheet" @click="fundOpen = false">✕</button>
    </div>
    <div class="mt-2 grid gap-1">
      <button v-for="sats in SATS_PRESETS" :key="sats" class="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-bold hover:bg-amber-100" @click="fund(sats)">
        <span>{{ sats.toLocaleString('en') }} sats</span>
        <span class="text-emerald-700">→ {{ (sats * 1000).toLocaleString('en') }} ks</span>
      </button>
    </div>
  </div>
  </div>
</template>
