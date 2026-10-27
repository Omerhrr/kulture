<script setup lang="ts">
// Phone → Shops: every store players run in the city, plus the city's own
// shops (paid with Lightning). Open a store to see its shelves: buy at the
// counter when you're standing in it, or order delivery (+10%) from
// anywhere. "Take me there" drives you over.
import { fmtKsats } from '~/utils/format'

const props = defineProps<{ owner?: string | null }>()
const api = useGameApi()
const ui = useUiStore()
const player = usePlayerStore()
const world = useWorldStore()
const payments = usePaymentsStore()
const phoneOpen = useState<boolean>('kk_phone_open', () => false)
const near = useState<null | { owner_id: string }>('kk_biz_near', () => null)

interface Store { owner_id: string; owner: string; name: string; kind: string; level: number; products: number }
interface Line { item: string; name: string; emoji: string; type: string; description: string; price: number; stock: number }
const stores = ref<Store[]>([])
const q = ref('')
const cur = ref<(Store & { shelf: Line[]; delivery_pct: number }) | null>(null)
const qty = ref<Record<string, number>>({})
const busy = ref('')

async function load() {
  try {
    stores.value = await api.apiGet<Store[]>('/stores')
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
async function open(owner: string) {
  try {
    cur.value = await api.apiGet<any>(`/stores/${owner}`)
    qty.value = {}
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
onMounted(() => (props.owner ? open(props.owner) : load()))
watch(() => props.owner, (o: string | null | undefined) => o && open(o))

const mine = computed(() => cur.value?.owner_id === player.profile?.id)
const here = computed(() => !!cur.value && near.value?.owner_id === cur.value.owner_id)
const shown = computed(() => {
  const t = q.value.trim().toLowerCase()
  return t ? stores.value.filter((s: Store) => `${s.name} ${s.owner}`.toLowerCase().includes(t)) : stores.value
})
const cityShops = computed(() => world.entities.filter((e) => e.business_id && ['shop', 'market'].includes(e.entity_type)))

async function buy(l: Line, delivery: boolean) {
  if (!cur.value || busy.value) return
  const n = qty.value[l.item] ?? 1
  busy.value = l.item
  try {
    const r = await api.apiPost<any>(`/stores/${cur.value.owner_id}/buy`, {
      item: l.item,
      qty: n,
      delivery,
      idempotency_key: `buy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    })
    ui.showToast(`${l.emoji} ${l.name} x${n} - ${fmtKsats(r.paid)}${delivery ? ' (delivered to your bag)' : ''}`, 'success')
    ;(window as any).__kk_ws_send?.('state.resync', {})
    await open(cur.value.owner_id)
  } catch (e: any) {
    ui.showToast(e.message || 'Could not buy', 'error')
  } finally {
    busy.value = ''
  }
}
function takeMeThere() {
  const b = (window as any).__kk_bizlist?.()?.find((x: any) => x.owner_id === cur.value?.owner_id)
  if (!b) return ui.showToast("Can't find it on the map right now", 'info')
  phoneOpen.value = false
  window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'place', place: { name: cur.value!.name, to: [b.x + Math.sin(b.rot) * 8, b.z + Math.cos(b.rot) * 8] } } }))
}
function cityShop(businessId: string) {
  phoneOpen.value = false
  payments.openForBusiness(businessId).then(() => ui.open('shop')).catch((e) => ui.showToast(e.message, 'error'))
}
</script>

<template>
  <div class="text-ink">
    <!-- a store -->
    <div v-if="cur" class="space-y-3">
      <button v-if="!props.owner" class="text-xs font-bold text-ink/50" @click="cur = null">‹ All shops</button>
      <div class="rounded-3xl bg-gradient-to-br p-4 text-white shadow" :class="cur.kind === 'restaurant' ? 'from-orange-500 to-rose-600' : 'from-emerald-600 to-teal-700'">
        <div class="text-[11px] font-bold uppercase tracking-widest text-white/70">{{ cur.kind === 'restaurant' ? 'Restaurant' : ['Shop', 'Supermarket', 'Mall'][cur.level - 1] ?? 'Shop' }}</div>
        <div class="font-display text-xl font-semibold leading-tight">{{ cur.name }}</div>
        <div class="text-xs text-white/80">run by {{ cur.owner }}</div>
        <div class="mt-2 flex gap-2">
          <span v-if="here" class="rounded-full bg-white/25 px-2.5 py-1 text-[11px] font-bold">📍 You're in the store</span>
          <button v-else-if="!mine" class="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold hover:bg-white/30" @click="takeMeThere">🚕 Take me there</button>
        </div>
      </div>
      <div v-if="mine" class="rounded-2xl bg-paper p-3 text-xs text-ink/60">This is your store. Manage the shelves in Business.</div>
      <div v-if="!cur.shelf.length" class="py-6 text-center text-sm text-ink/45">The shelves are empty right now.</div>
      <div v-for="l in cur.shelf" :key="l.item" class="rounded-2xl border border-ink/10 bg-white p-3">
        <div class="flex items-start gap-2.5">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-paper text-2xl">{{ l.emoji }}</span>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-bold">{{ l.name }}</div>
            <div class="line-clamp-2 text-[11px] text-ink/50">{{ l.description }}</div>
            <div class="mt-0.5 text-[11px] font-semibold text-ink/45">{{ l.stock }} left</div>
          </div>
          <div class="text-right text-sm font-bold tabular-nums text-kadeep">{{ fmtKsats(l.price) }}</div>
        </div>
        <div v-if="!mine" class="mt-2 flex items-center gap-2">
          <div class="flex items-center rounded-full bg-paper">
            <button class="h-8 w-8 font-bold" @click="qty[l.item] = Math.max(1, (qty[l.item] ?? 1) - 1)">−</button>
            <span class="w-5 text-center text-sm font-bold tabular-nums">{{ qty[l.item] ?? 1 }}</span>
            <button class="h-8 w-8 font-bold" @click="qty[l.item] = Math.min(l.stock, 10, (qty[l.item] ?? 1) + 1)">+</button>
          </div>
          <button v-if="here" class="kk-btn-primary flex-1 !py-1.5 text-xs" :disabled="!!busy" @click="buy(l, false)">Buy · {{ fmtKsats(l.price * (qty[l.item] ?? 1)) }}</button>
          <button v-else class="kk-btn-primary flex-1 !py-1.5 text-xs" :disabled="!!busy" @click="buy(l, true)">
            Deliver · {{ fmtKsats(Math.round(l.price * (qty[l.item] ?? 1) * (1 + cur.delivery_pct / 100))) }}
          </button>
        </div>
      </div>
    </div>

    <!-- the directory -->
    <div v-else class="space-y-3">
      <input v-model="q" class="w-full rounded-2xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-kadeep" placeholder="Search shops or owners" />
      <div>
        <div class="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest text-ink/40">Player stores</div>
        <div v-if="!shown.length" class="rounded-2xl bg-paper p-3 text-xs text-ink/50">No player has opened a store yet. Open yours from Business.</div>
        <button v-for="s in shown" :key="s.owner_id" class="mb-1.5 flex w-full items-center gap-2.5 rounded-2xl border border-ink/10 bg-white p-2.5 text-left hover:bg-ink/5" @click="open(s.owner_id)">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl text-xl" :class="s.kind === 'restaurant' ? 'bg-orange-100' : 'bg-emerald-100'">{{ s.kind === 'restaurant' ? '🍲' : '🛒' }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-bold">{{ s.name }}</span>
            <span class="text-[11px] text-ink/45">{{ s.owner }} · {{ s.products ? `${s.products} product${s.products > 1 ? 's' : ''}` : 'empty shelves' }}</span>
          </span>
          <span class="text-ink/30">›</span>
        </button>
      </div>
      <div>
        <div class="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest text-ink/40">City shops · pay with Lightning</div>
        <button v-for="e in cityShops" :key="e.id" class="mb-1.5 flex w-full items-center gap-2.5 rounded-2xl border border-ink/10 bg-white p-2.5 text-left hover:bg-ink/5" @click="cityShop(e.business_id!)">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-xl">⚡</span>
          <span class="min-w-0 flex-1 truncate text-sm font-bold">{{ e.name }}</span>
          <span class="text-ink/30">›</span>
        </button>
      </div>
    </div>
  </div>
</template>
