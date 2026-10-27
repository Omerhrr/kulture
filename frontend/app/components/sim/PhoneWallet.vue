<script setup lang="ts">
// Phone → Wallet: your k-sats, sending money to another player (by name or
// @username, with a note; the server pays exactly once per send), adding
// funds with a Lightning testnet deposit, and everything that came in or
// went out.
import { fmtKsats } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
const player = usePlayerStore()
const payments = usePaymentsStore()

interface Who { id: string; name: string; username: string }
interface Row { id: string; kind: string; amount: number; description: string; who: Who | null; note: string; at: string | null }
const balance = ref(0)
const rows = ref<Row[]>([])
const limits = ref({ min: 1000, max: 10_000_000, daily: 50_000_000 })
const screen = ref<'home' | 'send' | 'confirm' | 'sent' | 'add'>('home')

async function load() {
  try {
    const w = await api.apiGet<any>('/wallet')
    balance.value = w.balance
    rows.value = w.history
    limits.value = w.limits
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
onMounted(load)

// ---- send
const q = ref('')
const found = ref<Who[]>([])
const to = ref<Who | null>(null)
const amount = ref<number | null>(null)
const note = ref('')
const busy = ref(false)
const key = ref('')
const recent = computed(() => {
  const seen = new Map<string, Who>()
  for (const r of rows.value) if (r.who && !seen.has(r.who.id)) seen.set(r.who.id, r.who)
  return [...seen.values()].slice(0, 6)
})
let qt: ReturnType<typeof setTimeout> | undefined
watch(q, (v: string) => {
  clearTimeout(qt)
  if (v.trim().length < 2) return void (found.value = [])
  qt = setTimeout(async () => {
    try {
      found.value = await api.apiGet<Who[]>(`/wallet/people?q=${encodeURIComponent(v.trim())}`)
    } catch {}
  }, 250)
})
function startSend(w?: Who) {
  to.value = w ?? null
  amount.value = null
  note.value = ''
  q.value = ''
  screen.value = 'send'
}
const amountOk = computed(() => !!amount.value && amount.value >= limits.value.min && amount.value <= limits.value.max && amount.value <= balance.value)
function review() {
  if (!to.value || !amountOk.value) return
  key.value = `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  screen.value = 'confirm'
}
const sent = ref<any>(null)
async function send() {
  if (busy.value || !to.value || !amount.value) return
  busy.value = true
  try {
    sent.value = await api.apiPost<any>('/wallet/send', { to: to.value.id, amount: amount.value, note: note.value, idempotency_key: key.value })
    balance.value = sent.value.balance
    screen.value = 'sent'
    ;(window as any).__kk_ws_send?.('state.resync', {})
    load()
  } catch (e: any) {
    ui.showToast(e.message || 'Could not send', 'error')
  } finally {
    busy.value = false
  }
}

// ---- add funds (Lightning testnet deposit: 1 sat = 1,000 k-sats)
const SATS = [1000, 5000, 21000]
function deposit(sats: number) {
  payments.startDeposit(sats)
}

// ---- history
const ICON: Record<string, string> = {
  transfer_in: '⬇️', transfer_out: '⬆️', store_purchase: '🛒', store_sale: '💰', store_restock: '📦', job_reward: '📦', story_reward: '📖',
  shift_pay: '💼', grant_initial: '🎁', gift_sent: '🎁', gift_received: '🎁', deposit_credit: '⚡', venue_purchase: '🧾', business_sale: '🏪'
}
function when(iso: string | null) {
  if (!iso) return ''
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime()
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const QUICK = [50_000, 250_000, 1_000_000]
</script>

<template>
  <div class="text-ink">
    <!-- balance card -->
    <div v-if="screen === 'home'" class="space-y-3">
      <div class="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-800 p-4 text-white shadow-lg">
        <div class="text-[11px] font-bold uppercase tracking-widest text-white/70">Balance</div>
        <div class="mt-1 font-display text-3xl font-semibold tabular-nums">{{ fmtKsats(balance) }}</div>
        <div class="mt-0.5 text-[11px] text-white/70">@{{ player.profile?.username }}</div>
        <div class="mt-3 grid grid-cols-3 gap-2">
          <button class="rounded-2xl bg-white/15 py-2 text-xs font-bold hover:bg-white/25" @click="startSend()">⬆️ Send</button>
          <button class="rounded-2xl bg-white/15 py-2 text-xs font-bold hover:bg-white/25" @click="screen = 'add'">⚡ Add</button>
          <button class="rounded-2xl bg-white/15 py-2 text-xs font-bold hover:bg-white/25" @click="load">↻</button>
        </div>
      </div>
      <div v-if="recent.length">
        <div class="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-widest text-ink/40">Pay again</div>
        <div class="flex gap-2 overflow-x-auto pb-1">
          <button v-for="w in recent" :key="w.id" class="flex w-16 shrink-0 flex-col items-center gap-1" @click="startSend(w)">
            <span class="flex h-11 w-11 items-center justify-center rounded-full bg-kadeep font-display text-base font-semibold text-white">{{ w.name.charAt(0) }}</span>
            <span class="w-full truncate text-center text-[10px] font-semibold text-ink/70">{{ w.name }}</span>
          </button>
        </div>
      </div>
      <div>
        <div class="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest text-ink/40">Activity</div>
        <div v-if="!rows.length" class="py-6 text-center text-sm text-ink/45">Nothing yet.</div>
        <div v-for="r in rows" :key="r.id" class="flex items-center gap-2.5 border-b border-ink/5 px-1 py-2">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-base">{{ ICON[r.kind] ?? (r.amount > 0 ? '➕' : '➖') }}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] font-semibold">{{ r.who ? (r.amount > 0 ? `From ${r.who.name}` : `To ${r.who.name}`) : r.description }}</div>
            <div class="truncate text-[11px] text-ink/45">{{ r.note || (r.who ? '@' + r.who.username : '') }} · {{ when(r.at) }}</div>
          </div>
          <span class="shrink-0 text-[13px] font-bold tabular-nums" :class="r.amount > 0 ? 'text-leaf' : 'text-ink/70'">{{ r.amount > 0 ? '+' : '' }}{{ fmtKsats(r.amount) }}</span>
        </div>
      </div>
    </div>

    <!-- send: who and how much -->
    <div v-else-if="screen === 'send'" class="space-y-3">
      <button class="text-xs font-bold text-ink/50" @click="screen = 'home'">‹ Wallet</button>
      <div v-if="!to">
        <div class="font-display text-lg font-semibold">Send to</div>
        <input v-model="q" class="mt-2 w-full rounded-2xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-kadeep" placeholder="Name or @username" autofocus />
        <button v-for="w in found" :key="w.id" class="mt-1.5 flex w-full items-center gap-2.5 rounded-2xl px-2 py-2 text-left hover:bg-ink/5" @click="to = w">
          <span class="flex h-9 w-9 items-center justify-center rounded-full bg-kadeep font-semibold text-white">{{ w.name.charAt(0) }}</span>
          <span><span class="block text-sm font-semibold">{{ w.name }}</span><span class="text-[11px] text-ink/45">@{{ w.username }}</span></span>
        </button>
        <div v-if="q.trim().length >= 2 && !found.length" class="mt-2 text-xs text-ink/45">No players match.</div>
      </div>
      <template v-else>
        <div class="flex items-center gap-2.5 rounded-2xl bg-paper px-3 py-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-full bg-kadeep font-semibold text-white">{{ to.name.charAt(0) }}</span>
          <span class="flex-1"><span class="block text-sm font-semibold">{{ to.name }}</span><span class="text-[11px] text-ink/45">@{{ to.username }}</span></span>
          <button class="text-xs font-bold text-ink/45" @click="to = null">Change</button>
        </div>
        <label class="block">
          <span class="text-[11px] font-bold uppercase tracking-widest text-ink/40">Amount (k-sats)</span>
          <input v-model.number="amount" type="number" inputmode="numeric" :min="limits.min" :max="limits.max" class="mt-1 w-full rounded-2xl border border-ink/15 bg-white px-3 py-2.5 font-display text-2xl tabular-nums outline-none focus:border-kadeep" placeholder="0" />
        </label>
        <div class="flex gap-1.5">
          <button v-for="a in QUICK" :key="a" class="kk-chip" @click="amount = a">{{ fmtKsats(a) }}</button>
        </div>
        <div class="text-[11px]" :class="amount && !amountOk ? 'text-red-600' : 'text-ink/45'">
          {{ amount && amount > balance ? 'More than you have.' : `Between ${fmtKsats(limits.min)} and ${fmtKsats(limits.max)}. You have ${fmtKsats(balance)}.` }}
        </div>
        <input v-model="note" maxlength="80" class="w-full rounded-2xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-kadeep" placeholder="Note (optional) - e.g. for the suya" />
        <button class="kk-btn-primary w-full" :disabled="!amountOk" @click="review">Review</button>
      </template>
    </div>

    <!-- confirm -->
    <div v-else-if="screen === 'confirm' && to && amount" class="space-y-3 text-center">
      <div class="pt-2 text-[11px] font-bold uppercase tracking-widest text-ink/40">You're sending</div>
      <div class="font-display text-3xl font-semibold tabular-nums">{{ fmtKsats(amount) }}</div>
      <div class="text-sm">to <b>{{ to.name }}</b> <span class="text-ink/45">@{{ to.username }}</span></div>
      <div v-if="note" class="text-sm italic text-ink/60">"{{ note }}"</div>
      <div class="grid grid-cols-2 gap-2 pt-2">
        <button class="kk-btn-ghost" :disabled="busy" @click="screen = 'send'">Back</button>
        <button class="kk-btn-primary" :disabled="busy" @click="send">{{ busy ? 'Sending…' : 'Send now' }}</button>
      </div>
    </div>

    <!-- sent -->
    <div v-else-if="screen === 'sent' && sent" class="space-y-2 py-4 text-center">
      <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-leaf/10 text-2xl text-leaf">✓</div>
      <div class="font-display text-lg font-semibold">Sent {{ fmtKsats(sent.amount) }}</div>
      <div class="text-sm text-ink/60">{{ sent.to?.name }} has it now.</div>
      <button class="kk-btn-primary mt-2 w-full" @click="screen = 'home'">Done</button>
    </div>

    <!-- add funds -->
    <div v-else-if="screen === 'add'" class="space-y-3">
      <button class="text-xs font-bold text-ink/50" @click="screen = 'home'">‹ Wallet</button>
      <div class="font-display text-lg font-semibold">Add funds with Lightning</div>
      <p class="text-xs leading-relaxed text-ink/60">Pay a Lightning invoice on the Bitcoin testnet from your own wallet. 1 sat = 1,000 k-sats. The node confirms the payment before anything is credited.</p>
      <button v-for="s in SATS" :key="s" class="flex w-full items-center justify-between rounded-2xl border border-ink/10 bg-white px-3 py-2.5 hover:bg-ink/5" @click="deposit(s)">
        <span class="text-sm font-semibold">⚡ {{ s.toLocaleString('en') }} sats</span>
        <span class="text-xs font-bold text-leaf">+{{ fmtKsats(s * 1000) }}</span>
      </button>
    </div>
  </div>
</template>
