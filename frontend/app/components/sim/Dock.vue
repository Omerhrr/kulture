<script setup lang="ts">
// Dock - the four big verbs of the life sim, always one tap away.
import { fireKkEvent, useMapOpen, useInterior } from '~/composables/useControlsState'

const ui = useUiStore()
const world = useWorldStore()
const payments = usePaymentsStore()
const mapOpen = useMapOpen()
const interior = useInterior()
const phoneOpen = useState<boolean>('kk_phone_open', () => false)

async function buy() {
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
  { id: 'buy', icon: '🛋️', label: 'Buy', on: ui.openPanel === 'shop', run: buy },
  { id: 'map', icon: '🗺️', label: 'Map', on: mapOpen.value, run: () => (mapOpen.value = !mapOpen.value) },
  { id: 'phone', icon: '📱', label: 'Phone', on: phoneOpen.value, run: () => (phoneOpen.value = !phoneOpen.value) }
])
</script>

<template>
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
</template>
