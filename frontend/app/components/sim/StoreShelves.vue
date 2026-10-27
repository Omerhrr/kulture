<script setup lang="ts">
// Business → Shelves: the products your store sells to other players.
// Stock them at wholesale (or from your bag), set your price, take them
// off. Sales pay you at once (less the city's market levy).
import { fmtKsats, fmtKsatsShort } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
interface Line { item: string; name: string; emoji: string; price: number; stock: number; sold: number; wholesale: number }
interface Cat { item: string; name: string; emoji: string; wholesale: number }
const s = ref<null | { name: string; slots: number; shelf: Line[]; catalog: Cat[]; bag: { item: string; name: string; emoji: string; qty: number }[]; levy_pct: number; balance: number }>(null)
const busy = ref(false)
const adding = ref(false)
const price = ref<Record<string, number>>({})

async function load() {
  try {
    s.value = await api.apiGet<any>('/stores/mine')
    price.value = Object.fromEntries(s.value!.shelf.map((l: Line) => [l.item, l.price]))
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
onMounted(load)
async function act(path: string, body: Record<string, unknown>, ok?: string) {
  if (busy.value) return
  busy.value = true
  try {
    s.value = await api.apiPost<any>(`/stores/mine/${path}`, body)
    price.value = Object.fromEntries(s.value!.shelf.map((l: Line) => [l.item, l.price]))
    if (ok) ui.showToast(ok, 'success')
    ;(window as any).__kk_ws_send?.('state.resync', {})
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
const onShelf = computed(() => new Set(s.value?.shelf.map((l: Line) => l.item)))
const full = computed(() => !!s.value && s.value.shelf.length >= s.value.slots)
const margin = (l: Line) => Math.round(((price.value[l.item] ?? l.price) / l.wholesale - 1) * 100)
</script>

<template>
  <div v-if="s" class="space-y-2.5 text-ink">
    <div class="flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-widest text-ink/40">
      <span>On the shelves · {{ s.shelf.length }}/{{ s.slots }}</span>
      <span>Levy {{ s.levy_pct }}%</span>
    </div>
    <div v-if="!s.shelf.length" class="rounded-2xl bg-paper p-3 text-xs text-ink/55">Nothing for sale yet. Add products below: other players find your store in the Shops app or walk in.</div>
    <div v-for="l in s.shelf" :key="l.item" class="rounded-2xl border border-ink/10 bg-white p-2.5">
      <div class="flex items-center gap-2">
        <span class="text-2xl">{{ l.emoji }}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-bold">{{ l.name }}</div>
          <div class="text-[11px] text-ink/45">{{ l.stock }} in stock · {{ l.sold }} sold · wholesale {{ fmtKsats(l.wholesale) }}</div>
        </div>
        <button class="text-[11px] font-bold text-ink/40 hover:text-red-600" :disabled="busy" @click="act('unshelve', { item: l.item }, 'Back in your bag')">Remove</button>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <input v-model.number="price[l.item]" type="number" class="w-28 rounded-xl border border-ink/15 px-2 py-1 text-sm tabular-nums" />
        <button class="kk-chip" :disabled="busy || price[l.item] === l.price" @click="act('price', { item: l.item, price: price[l.item] }, 'Price set')">Set price</button>
        <span class="ml-auto text-[11px] font-bold" :class="margin(l) >= 0 ? 'text-leaf' : 'text-red-600'">{{ margin(l) >= 0 ? '+' : '' }}{{ margin(l) }}%</span>
      </div>
      <div class="mt-1.5 flex gap-1">
        <button v-for="n in [5, 10, 25]" :key="n" class="kk-chip" :disabled="busy || l.stock + n > 99" @click="act('restock', { item: l.item, qty: n }, `+${n} ${l.name}`)">+{{ n }} · {{ fmtKsatsShort(n * l.wholesale) }}</button>
      </div>
    </div>

    <button v-if="!adding" class="w-full rounded-2xl border-2 border-dashed border-ink/15 py-2.5 text-sm font-bold text-ink/50 hover:bg-ink/5" :disabled="full" @click="adding = true">
      {{ full ? 'Shelves full - grow the business for more' : '+ Add a product' }}
    </button>
    <div v-else class="rounded-2xl bg-paper p-2.5">
      <div class="mb-1 flex items-center justify-between"><span class="text-xs font-bold">Wholesalers</span><button class="text-xs font-bold text-ink/45" @click="adding = false">Done</button></div>
      <button v-for="c in s.catalog.filter((c: Cat) => !onShelf.has(c.item))" :key="c.item" class="mb-1 flex w-full items-center gap-2 rounded-xl bg-white px-2 py-1.5 text-left hover:bg-ink/5" :disabled="busy || full" @click="act('restock', { item: c.item, qty: 5 }, `${c.name} on your shelf`)">
        <span class="text-lg">{{ c.emoji }}</span>
        <span class="flex-1 text-xs font-semibold">{{ c.name }}</span>
        <span class="text-[11px] text-ink/50">5 for {{ fmtKsats(5 * c.wholesale) }}</span>
      </button>
      <template v-if="s.bag.length">
        <div class="mb-1 mt-2 text-xs font-bold">From your bag</div>
        <button v-for="b in s.bag" :key="b.item" class="mb-1 flex w-full items-center gap-2 rounded-xl bg-white px-2 py-1.5 text-left hover:bg-ink/5" :disabled="busy" @click="act('shelve', { item: b.item, qty: b.qty }, `${b.name} on your shelf`)">
          <span class="text-lg">{{ b.emoji }}</span>
          <span class="flex-1 text-xs font-semibold">{{ b.name }}</span>
          <span class="text-[11px] text-ink/50">shelve all {{ b.qty }}</span>
        </button>
      </template>
    </div>
  </div>
</template>
