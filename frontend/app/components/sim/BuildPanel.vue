<script setup lang="ts">
// BuildPanel - build mode in your home: buy furniture from the catalogue,
// tap a piece to select it, drag it on the floor, rotate it, sell it.
// Prices are simulated naira (the server owns money and ownership).
import { useHomeStore } from '~/stores/home'
import { ITEMS } from '~/utils/furniture'
import { fmtNgn } from '~/utils/format'

const home = useHomeStore()
const ui = useUiStore()
const interior = useInterior()
const ICON: Record<string, string> = { sofa3: '🛋️', armchair: '💺', coffee_table: '🫖', tv_console: '📺', rug: '🟫', floor_lamp: '💡', snake_plant: '🪴', bookshelf: '📚', standing_fan: '🌀', dining_set: '🍽️', plastic_chair: '🪑', bed_double: '🛏️', wardrobe: '🚪', deep_freezer: '🧊', generator: '⚙️' }
const CATS = ['All', 'Living', 'Bedroom', 'Dining', 'Kitchen', 'Comfort', 'Decor']
const cat = ref('All')
const list = computed(() => home.catalog.filter((c) => cat.value === 'All' || c.category === cat.value))
const sel = computed(() => home.selectedItem)
const selCat = computed(() => home.catalog.find((c) => c.sku === sel.value?.sku))
const confirmSell = ref(false)
watch(() => home.selected, () => (confirmSell.value = false))

async function buy(sku: string) {
  try {
    await home.buy(sku, 0, 0)
    ui.showToast(`${ITEMS[sku]?.name ?? 'Item'} delivered. Drag it where you want it.`, 'success')
  } catch (e: any) {
    ui.showToast(e.message || 'Could not buy that', 'error')
  }
}
function rotate() {
  const it = sel.value
  if (it) home.move(it.uid, it.x, it.z, (it.rot + 1) % 4).catch((e: any) => ui.showToast(e.message, 'error'))
}
async function sell() {
  const it = sel.value
  if (!it) return
  if (!confirmSell.value) return void (confirmSell.value = true)
  try {
    const r = await home.sell(it.uid)
    ui.showToast(`Sold for ${fmtNgn(r)}`, 'success')
  } catch (e: any) {
    ui.showToast(e.message || 'Could not sell', 'error')
  }
}
</script>

<template>
  <div v-if="home.build && interior.inside" class="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex justify-center px-2 pb-24 sm:pb-[6.2rem]">
    <div class="kk-panel w-[min(760px,98vw)] p-3 sm:p-4">
      <!-- selected piece -->
      <div v-if="sel" class="flex flex-wrap items-center gap-3">
        <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-2xl">{{ ICON[sel.sku] ?? '📦' }}</span>
        <div class="min-w-0 flex-1">
          <div class="font-display text-base font-semibold text-ink">{{ ITEMS[sel.sku]?.name ?? sel.sku }}</div>
          <div class="text-xs text-ink/50">Drag it on the floor to move it</div>
        </div>
        <button class="rounded-full bg-ink/5 px-4 py-2.5 text-sm font-bold text-ink hover:bg-ink/10" @click="rotate">⟳ Rotate</button>
        <button class="rounded-full px-4 py-2.5 text-sm font-bold" :class="confirmSell ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'" :disabled="home.busy" @click="sell">
          {{ confirmSell ? `Confirm · +${fmtNgn(selCat?.sell_ngn_minor ?? 0)}` : `Sell · ${fmtNgn(selCat?.sell_ngn_minor ?? 0)}` }}
        </button>
        <button class="rounded-full bg-leaf px-4 py-2.5 text-sm font-bold text-white hover:bg-kadeep" @click="home.selected = null">Done</button>
      </div>
      <!-- catalogue -->
      <template v-else>
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="font-display text-base font-semibold text-ink">🛋️ Buy furniture <span class="ml-1 text-xs font-bold text-ink/45">tap a piece in your home to move or sell it</span></div>
          <button class="kk-close" aria-label="Close build mode" @click="home.build = false">✕</button>
        </div>
        <div class="mb-2 flex gap-1 overflow-x-auto">
          <button v-for="c in CATS" :key="c" class="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold" :class="cat === c ? 'bg-ink text-white' : 'bg-ink/5 text-ink/70'" @click="cat = c">{{ c }}</button>
        </div>
        <div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button v-for="c in list" :key="c.sku" class="flex w-28 shrink-0 flex-col items-center gap-1 rounded-2xl border border-ink/10 bg-white p-2.5 text-center hover:border-leaf disabled:opacity-40" :disabled="home.busy || home.balance < c.price_ngn_minor" @click="buy(c.sku)">
            <span class="text-3xl">{{ ICON[c.sku] ?? '📦' }}</span>
            <span class="line-clamp-2 text-[11px] font-bold leading-tight text-ink">{{ c.name }}</span>
            <span class="text-xs font-extrabold text-leaf">{{ fmtNgn(c.price_ngn_minor) }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
