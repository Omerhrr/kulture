<script setup lang="ts">
// Phone → Contacts / Connect: everyone you know (NPCs remember you), nearby
// players, chats (NPCs answer with AI + memory; players get real DMs), the
// Kulture Connect dating app, dates with choices, proposals and the owambe.
import { fmtKsats } from '~/utils/format'

const props = defineProps<{ tab?: 'contacts' | 'connect' }>()
const api = useGameApi()
const ui = useUiStore()
const tab = ref<'contacts' | 'connect' | 'chat' | 'date'>(props.tab ?? 'contacts')
const rels = ref<any[]>([])
const nearby = ref<any[]>([])
const feed = ref<any>(null)
const cur = ref<any>(null) // relationship or {kind:'player', other_id, name}
const msgs = ref<{ me: boolean; text: string }[]>([])
const text = ref('')
const date = ref<any>(null)
const busy = ref(false)
const giftOpen = ref(false)
const bag = ref<{ code: string; name: string; qty: number }[]>([])
const pending = useState<any>('kk_game_pending', () => null)
const goto = useState<string | null>('kk_phone_goto', () => null)
async function challenge(game: string) {
  busy.value = true
  try {
    const m = await api.apiPost<any>('/games/join', { game, invite: cur.value.other_id })
    await api.apiPost('/social/dm', { to: cur.value.other_id, text: `🎮 I challenged you to ${m.name}! Accept from the invite pop-up.` }).catch(() => {})
    pending.value = { open: m.id }
    goto.value = 'games'
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
function fightInvite() {
  window.dispatchEvent(new CustomEvent('kk-fight-invite', { detail: { to: cur.value.other_id, name: cur.value.name } }))
}
async function sendGift(g: { amount?: number; item?: string }) {
  busy.value = true
  try {
    await api.apiPost('/gifts', { to: cur.value.other_id, ...g })
    msgs.value.push({ me: true, text: g.amount ? `🎁 Sent you ${fmtKsats(g.amount)}` : `🎁 Sent you a ${bag.value.find((b) => b.code === g.item)?.name}` })
    ui.showToast('Gift sent 🎁', 'success')
    giftOpen.value = false
    loadBag()
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
const playerStore = usePlayerStore()
function loadBag() {
  bag.value = playerStore.inventory.filter((i) => i.quantity > 0 && i.code !== 'quest_parcel').map((i) => ({ code: i.code, name: `${i.emoji ?? ''} ${i.name}`.trim(), qty: i.quantity }))
}
watch(giftOpen, (o) => o && loadBag())

async function load() {
  const r = await api.apiGet<any>('/social/relationships')
  rels.value = r.relationships
  nearby.value = r.nearby
}
watch(
  tab,
  async (t) => {
    if (t === 'connect' && !feed.value) feed.value = await api.apiGet<any>('/social/dating')
    if (t === 'contacts') await load()
  },
  { immediate: true }
)

const STATUS: Record<string, string> = { acquaintance: 'Met', friend: 'Friend', best_friend: 'Best friend', dating: 'Dating 💕', partner: 'Partner ❤️', engaged: 'Engaged 💍', married: 'Married 💒' }

async function openChat(r: any) {
  cur.value = r
  msgs.value = []
  tab.value = 'chat'
  if (r.kind === 'player') {
    const t = await api.apiGet<any>(`/social/dm/${r.other_id}`)
    msgs.value = t.messages.map((m: any) => ({ me: m.from !== r.other_id, text: m.text }))
  } else if (r.memory?.length) {
    msgs.value = [{ me: false, text: `(${r.name} remembers: ${r.memory[r.memory.length - 1]})` }]
  }
}
async function send() {
  const t = text.value.trim()
  if (!t || !cur.value || busy.value) return
  text.value = ''
  msgs.value.push({ me: true, text: t })
  busy.value = true
  try {
    if (cur.value.kind === 'player') {
      await api.apiPost('/social/dm', { to: cur.value.other_id, text: t })
    } else {
      const r = await api.apiPost<any>('/social/npc-chat', { npc_id: cur.value.other_id, name: cur.value.name, text: t })
      msgs.value.push({ me: false, text: r.reply })
      cur.value = r.relationship
    }
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
function onWs(ev: Event) {
  const d = (ev as CustomEvent).detail
  if (d?.type === 'social.dm') {
    if (cur.value?.kind === 'player' && cur.value.other_id === d.payload.from) msgs.value.push({ me: false, text: d.payload.text })
    else load()
  }
}
onMounted(() => window.addEventListener('kk-ws', onWs))
onBeforeUnmount(() => window.removeEventListener('kk-ws', onWs))

async function like(p: any) {
  try {
    const r = await api.apiPost<any>('/social/like', { kind: p.kind, id: p.id })
    ui.showToast(r.match ? `It's a match with ${p.name}! 💘` : `You liked ${p.name}.`, r.match ? 'success' : 'info')
    await load()
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
async function startDate(place: string) {
  try {
    date.value = await api.apiPost<any>('/social/date/start', { rel_id: cur.value.id, place })
    tab.value = 'date'
    // the partner meets you there in the 3D world
    window.dispatchEvent(new CustomEvent('kk-date', { detail: { place, name: cur.value.name, active: true } }))
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
async function choose(i: number) {
  const r = await api.apiPost<any>('/social/date/choose', { rel_id: cur.value.id, choice: i })
  date.value = r
  cur.value = r.relationship
  if (r.finished) {
    window.dispatchEvent(new CustomEvent('kk-date', { detail: { active: false, outcome: r.outcome } }))
    ui.showToast(r.outcome === 'great' ? `${cur.value.name} had a wonderful time! 💕` : r.outcome === 'okay' ? 'The date was okay.' : 'That date did not go well…', r.outcome === 'bad' ? 'error' : 'success')
  }
}
async function propose() {
  try {
    const r = await api.apiPost<any>('/social/propose', { rel_id: cur.value.id })
    cur.value = r.relationship
    ui.showToast(r.accepted ? `${cur.value.name} said YES! 💍` : `${cur.value.name} isn't ready yet…`, r.accepted ? 'success' : 'error')
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
async function wed() {
  try {
    const r = await api.apiPost<any>('/social/wedding', { rel_id: cur.value.id })
    cur.value = r.relationship
    window.dispatchEvent(new CustomEvent('kk-owambe', { detail: { partner: cur.value.name } }))
    ui.showToast('Congratulations! The owambe has started 🎉', 'success')
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
function talkToPlayer(p: any) {
  openChat({ kind: 'player', other_id: p.id, name: p.name })
}
</script>

<template>
  <div class="flex h-full flex-col text-ink">
    <div v-if="tab === 'contacts' || tab === 'connect'" class="mb-2 flex gap-1 rounded-full bg-ink/5 p-1 text-xs font-bold">
      <button class="flex-1 rounded-full py-1.5" :class="tab === 'contacts' && 'bg-white shadow'" @click="tab = 'contacts'">Contacts</button>
      <button class="flex-1 rounded-full py-1.5" :class="tab === 'connect' && 'bg-white shadow'" @click="tab = 'connect'">💘 Connect</button>
    </div>

    <!-- contacts -->
    <div v-if="tab === 'contacts'" class="space-y-1.5">
      <div v-if="!rels.length && !nearby.length" class="p-3 text-center text-xs text-ink/50">Nobody yet. Greet people around Kaduna, or try Connect.</div>
      <button v-for="r in rels" :key="r.id" class="flex w-full items-center gap-2 rounded-2xl bg-ink/[0.04] p-2.5 text-left" @click="openChat(r)">
        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-violet-400 text-sm font-bold text-white">{{ r.name[0] }}</span>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-bold">{{ r.name }} <span class="text-[10px] font-semibold text-ink/45">{{ r.kind === 'player' ? '· player' : '' }}</span></div>
          <div class="text-[10px] text-ink/55">{{ STATUS[r.status] }} · 🤝 {{ r.friendship }} · 💗 {{ r.romance }}</div>
        </div>
        <span v-if="r.unread" class="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{{ r.unread }}</span>
      </button>
      <div v-if="nearby.length" class="pt-2 text-[11px] font-bold text-ink/50">Players nearby</div>
      <button v-for="p in nearby" :key="p.id" class="flex w-full items-center gap-2 rounded-2xl bg-sky-50 p-2.5 text-left" @click="talkToPlayer(p)">
        <span class="text-lg">🟢</span><span class="text-[13px] font-bold">{{ p.name }}</span>
      </button>
    </div>

    <!-- dating feed -->
    <div v-else-if="tab === 'connect'" class="space-y-2">
      <div v-if="!feed" class="p-3 text-center text-xs text-ink/50">Loading…</div>
      <div v-for="p in feed?.people" :key="p.id" class="rounded-2xl bg-gradient-to-br from-rose-50 to-violet-50 p-3">
        <div class="text-[14px] font-bold">{{ p.name }}<span v-if="p.age">, {{ p.age }}</span></div>
        <div class="text-[11px] text-ink/60">{{ p.job }}</div>
        <div class="my-1 text-[11px] italic text-ink/70">“{{ p.bio }}”</div>
        <button class="rounded-full bg-rose-500 px-4 py-1 text-xs font-bold text-white" @click="like(p)">♥ Like</button>
      </div>
    </div>

    <!-- chat -->
    <div v-else-if="tab === 'chat' && cur" class="flex min-h-0 flex-1 flex-col">
      <div class="mb-2 flex items-center gap-2">
        <button class="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-bold" @click="tab = 'contacts'">‹</button>
        <div class="flex-1 text-sm font-bold">{{ cur.name }} <span class="text-[10px] text-ink/50">{{ STATUS[cur.status] ?? '' }}</span></div>
      </div>
      <div v-if="cur.id" class="mb-2 flex flex-wrap gap-1">
        <button v-for="(p, k) in { restaurant: '🍲 Dinner', cinema: '🎬 Cinema', park: '🌳 Park walk' }" :key="k" class="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-700" @click="startDate(String(k))">{{ p }}</button>
        <button v-if="['dating', 'partner'].includes(cur.status)" class="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700" @click="propose">💍 Propose</button>
        <template v-if="cur.kind === 'player'">
          <button v-for="g in [['whot', '🃏 Whot'], ['ludo', '🎲 Ludo'], ['ayo', '🥜 Ayo']]" :key="g[0]" class="rounded-full bg-lime-100 px-2 py-1 text-[10px] font-bold text-lime-800" :disabled="busy" @click="challenge(g[0])">{{ g[1] }}</button>
          <button class="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-800" :disabled="busy" @click="fightInvite">🥊 Fight</button>
          <button class="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800" @click="giftOpen = !giftOpen">🎁 Gift</button>
        </template>
        <button v-if="cur.status === 'engaged'" class="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700" @click="wed">💒 Wedding & owambe</button>
      </div>
      <div v-if="giftOpen && cur.kind === 'player'" class="mb-2 space-y-1.5 rounded-2xl bg-amber-50 p-2 text-[11px]">
        <div class="font-bold text-amber-800">Send {{ cur.name }} a gift</div>
        <div class="flex flex-wrap gap-1">
          <button v-for="v in [50000, 100000, 500000, 1000000]" :key="v" class="rounded-full bg-white px-2 py-1 font-bold" :disabled="busy" @click="sendGift({ amount: v })">{{ fmtKsats(v) }}</button>
        </div>
        <div v-if="bag.length" class="flex flex-wrap gap-1">
          <button v-for="it in bag" :key="it.code" class="rounded-full bg-white px-2 py-1 font-semibold" :disabled="busy" @click="sendGift({ item: it.code })">{{ it.name }} ×{{ it.qty }}</button>
        </div>
      </div>
      <div class="kk-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        <div v-for="(m, i) in msgs" :key="i" class="max-w-[85%] rounded-2xl px-3 py-1.5 text-[12px]" :class="m.me ? 'ml-auto bg-violet-600 text-white' : 'bg-ink/[0.06]'">{{ m.text }}</div>
      </div>
      <form class="mt-2 flex gap-1" @submit.prevent="send">
        <input v-model="text" maxlength="400" placeholder="Sannu…" class="min-w-0 flex-1 rounded-full border border-ink/10 px-3 py-1.5 text-xs" />
        <button class="rounded-full bg-violet-600 px-3 text-xs font-bold text-white" :disabled="busy">Send</button>
      </form>
    </div>

    <!-- date in progress -->
    <div v-else-if="tab === 'date' && date" class="space-y-2">
      <div class="rounded-2xl bg-rose-50 p-3 text-xs font-bold text-rose-700">Date with {{ date.relationship.name }} · mood {{ date.mood ?? '—' }}</div>
      <div class="h-2 overflow-hidden rounded-full bg-ink/10"><div class="h-full bg-rose-500 transition-all" :style="{ width: `${date.mood ?? 0}%` }" /></div>
      <template v-if="date.step">
        <div class="rounded-2xl bg-ink/[0.04] p-3 text-[13px] font-semibold">{{ date.step.prompt }}</div>
        <button v-for="(o, i) in date.step.options" :key="i" class="block w-full rounded-xl bg-white px-3 py-2 text-left text-xs font-semibold shadow-sm" @click="choose(i)">{{ o }}</button>
      </template>
      <template v-else>
        <div class="rounded-2xl p-3 text-sm font-bold" :class="date.outcome === 'bad' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'">
          {{ date.outcome === 'great' ? 'A wonderful evening 💕' : date.outcome === 'okay' ? 'Not bad at all.' : 'Awkward…' }} (romance {{ date.romance_change > 0 ? '+' : '' }}{{ date.romance_change }})
        </div>
        <button class="w-full rounded-full bg-ink py-2 text-xs font-bold text-white" @click="tab = 'chat'">Back to chat</button>
      </template>
    </div>
    <div v-if="feed && tab === 'connect'" class="mt-2 text-[10px] text-ink/45">Ring {{ fmtKsats(feed.ring_price) }} · Wedding & owambe {{ fmtKsats(feed.wedding_price) }}</div>
  </div>
</template>
