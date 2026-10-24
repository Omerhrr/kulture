<script setup lang="ts">
// Phone → Games: Whot, Ludo, Ayo and Naija Trivia against real players
// (bots fill empty seats after ~15 s). Optional small stakes in k-sats or
// sats are escrowed by the server; the winner takes the pot.
import { fmtKsats } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
const games = ref<any[]>([])
const cap = ref<Record<string, number>>({})
const pick = ref('whot')
const stake = ref(0)
const asset = ref<'ksats' | 'sats_ref'>('ksats')
const m = ref<any>(null)
const busy = ref(false)
const shapeFor = ref<string | null>(null)
const pending = useState<any>('kk_game_pending', () => null)
let timer: any = null

onMounted(async () => {
  const r = await api.apiGet<any>('/games')
  games.value = r.games
  cap.value = r.stake_cap
  window.addEventListener('kk-ws', onWs)
  // deep link from a friend's invite (accept) or my own challenge (open)
  const pend = pending.value
  pending.value = null
  if (pend?.accept) {
    try {
      m.value = await api.apiPost<any>('/games/join', { game: pend.game, match_id: pend.accept })
    } catch (e: any) {
      ui.showToast(e.message === 'No match.' ? 'That invite has expired.' : e.message, 'error')
    }
  } else if (pend?.open) {
    m.value = await api.apiGet<any>(`/games/match/${pend.open}`).catch(() => null)
  }
  if (m.value) timer = setInterval(refresh, 1000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('kk-ws', onWs)
})
function onWs(ev: Event) {
  const d = (ev as CustomEvent).detail
  if (d?.type === 'game.update' && m.value && d.payload.id === m.value.id) refresh()
}
async function refresh() {
  if (!m.value) return
  try {
    m.value = await api.apiGet<any>(`/games/match/${m.value.id}`)
    if (m.value.status === 'done') clearInterval(timer)
  } catch {}
}
async function join(vsBots: boolean) {
  busy.value = true
  try {
    m.value = await api.apiPost<any>('/games/join', { game: pick.value, stake: stake.value, asset: asset.value, vs_bots: vsBots })
    clearInterval(timer)
    timer = setInterval(refresh, 1000)
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
async function move(mv: any) {
  try {
    m.value = await api.apiPost<any>(`/games/match/${m.value.id}/move`, { move: mv })
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
async function leave() {
  if (m.value && m.value.status !== 'done') await api.apiPost(`/games/match/${m.value.id}/leave`).catch(() => {})
  clearInterval(timer)
  m.value = null
}
const names = computed<Record<string, string>>(() => Object.fromEntries((m.value?.players ?? []).map((p: any) => [p.id, p.id === m.value.you ? 'You' : p.name])))
const nm = (id: string) => names.value[id] ?? '?'
const myTurn = computed(() => m.value?.status === 'playing' && m.value.turn === m.value.you)
const s = computed(() => m.value?.state)
const logText = (l: string) => Object.entries(names.value).reduce((t, [id, n]) => t.split(id).join(String(n)), l)
const fmtStake = (v: number) => (asset.value === 'sats_ref' ? `${v} sats` : fmtKsats(v))

// ---- whot
const SHAPE_ICON: Record<string, string> = { circle: '●', triangle: '▲', cross: '✚', square: '■', star: '★', whot: 'W' }
const card = (c: string) => { const [sh, n] = c.split(':'); return { sh: sh!, n: n! } }
function playWhot(c: string) {
  if (card(c).n === '20') shapeFor.value = c
  else move({ play: c })
}
// ---- ludo
const COLORS = ['#e11d48', '#16a34a', '#2563eb', '#eab308']
const tokLabel = (p: number) => (p < 0 ? 'Base' : p >= 57 ? 'Home' : p > 50 ? `Run ${p - 50}` : `Sq ${p}`)
</script>

<template>
  <div class="space-y-2 text-ink">
    <!-- lobby -->
    <template v-if="!m">
      <div class="grid grid-cols-2 gap-2">
        <button v-for="g in games" :key="g.id" class="rounded-2xl p-3 text-left" :class="pick === g.id ? 'bg-ink text-white' : 'bg-ink/[0.05]'" @click="pick = g.id">
          <div class="text-xl">{{ { whot: '🃏', ludo: '🎲', ayo: '🥜', trivia: '🧠' }[g.id as string] }}</div>
          <div class="text-[13px] font-bold">{{ g.name }}</div>
          <div class="text-[10px] opacity-60">{{ g.seats[0] }}–{{ g.seats[1] }} players</div>
        </button>
      </div>
      <div class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="mb-1 flex items-center justify-between text-xs font-bold">
          <span>Stake</span>
          <span class="flex gap-1">
            <button class="rounded-full px-2" :class="asset === 'ksats' ? 'bg-ink text-white' : 'bg-white'" @click="(asset = 'ksats'), (stake = 0)">ks</button>
            <button class="rounded-full px-2" :class="asset === 'sats_ref' ? 'bg-amber-500 text-white' : 'bg-white'" @click="(asset = 'sats_ref'), (stake = 0)">⚡ sats</button>
          </span>
        </div>
        <div class="flex flex-wrap gap-1">
          <button v-for="v in (asset === 'ksats' ? [0, 10000, 50000, 100000, 500000] : [0, 21, 100, 500, 1000])" :key="v" class="rounded-full px-2.5 py-1 text-[11px] font-bold" :class="stake === v ? 'bg-violet-600 text-white' : 'bg-white'" @click="stake = v">{{ v ? fmtStake(v) : 'Free' }}</button>
        </div>
      </div>
      <button class="w-full rounded-full bg-violet-600 py-2.5 text-sm font-bold text-white" :disabled="busy" @click="join(false)">Find players</button>
      <button class="w-full rounded-full bg-ink/10 py-2 text-xs font-bold" :disabled="busy" @click="join(true)">Play now vs computer</button>
    </template>

    <!-- table -->
    <template v-else>
      <div class="flex items-center justify-between text-xs font-bold">
        <span>{{ m.name }} <span v-if="m.stake" class="text-amber-600">· pot {{ m.asset === 'sats_ref' ? `${m.stake * m.players.length} sats` : fmtKsats(m.stake * m.players.length) }}</span></span>
        <button class="rounded-full bg-ink/10 px-2 py-0.5" @click="leave">{{ m.status === 'done' ? 'Close' : 'Leave' }}</button>
      </div>
      <div v-if="m.status === 'waiting'" class="rounded-2xl bg-sky-50 p-4 text-center text-xs font-semibold text-sky-700">
        <template v-if="m.invite">⏳ Waiting for your friend to accept…<br />The invite lasts 3 minutes; any stake comes back if they don't come.</template>
        <template v-else>Waiting for players… ({{ m.players.length }} at the table)<br />Bots will join in a few seconds.</template>
      </div>
      <div v-else-if="m.status === 'done'" class="rounded-2xl p-3 text-center text-sm font-bold" :class="m.winner === m.you ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'">
        {{ m.winner === m.you ? '🏆 You won!' : m.winner ? `${nm(m.winner)} won` : 'Draw' }}
      </div>
      <div v-else class="text-center text-[11px] font-bold" :class="myTurn ? 'text-emerald-600' : 'text-ink/50'">
        {{ m.game === 'trivia' ? 'Answer fast for bonus points' : myTurn ? 'Your turn' : `${nm(m.turn)}'s turn…` }}
      </div>

      <!-- AYO -->
      <div v-if="m.game === 'ayo' && s" class="rounded-2xl bg-[#7c4a21] p-2 text-white">
        <div class="mb-1 text-center text-[10px]">{{ nm(s.players[1 - Math.max(0, s.you)]) }} · store {{ s.store[1 - Math.max(0, s.you)] }}</div>
        <div v-for="row in (s.you === 1 ? [[0,1,2,3,4,5].reverse(), [6,7,8,9,10,11]] : [[6,7,8,9,10,11].reverse(), [0,1,2,3,4,5]])" :key="row[0]" class="grid grid-cols-6 gap-1 py-0.5">
          <button v-for="p in row" :key="p" class="flex aspect-square items-center justify-center rounded-full text-sm font-bold" :class="s.legal.includes(p) ? 'bg-amber-300 text-ink ring-2 ring-white' : 'bg-[#4a2a10]'" :disabled="!s.legal.includes(p)" @click="move(p)">{{ s.pits[p] }}</button>
        </div>
        <div class="mt-1 text-center text-[10px]">You · store {{ s.store[Math.max(0, s.you)] }}</div>
      </div>

      <!-- WHOT -->
      <div v-if="m.game === 'whot' && s" class="space-y-2">
        <div class="flex items-center justify-center gap-3">
          <div class="flex h-20 w-14 flex-col items-center justify-center rounded-lg bg-[#7a1f2b] text-white shadow"><span class="text-[10px]">Market</span><b>{{ s.deck }}</b></div>
          <div class="flex h-20 w-14 flex-col items-center justify-center rounded-lg border-2 border-[#7a1f2b] bg-white text-[#7a1f2b] shadow">
            <span class="text-xl">{{ SHAPE_ICON[card(s.top).sh] }}</span><b>{{ card(s.top).n }}</b>
          </div>
        </div>
        <div v-if="s.want" class="text-center text-[11px] font-bold text-violet-700">I need: {{ SHAPE_ICON[s.want] }} {{ s.want }}</div>
        <div v-if="s.pick" class="text-center text-[11px] font-bold text-rose-600">Pick {{ s.pick }}!</div>
        <div class="flex flex-wrap justify-center gap-1 text-[10px]">
          <span v-for="(n, id) in s.counts" :key="id" class="rounded-full bg-ink/5 px-2">{{ nm(String(id)) }}: {{ n }}</span>
        </div>
        <div class="flex flex-wrap justify-center gap-1">
          <button v-for="c in s.hand" :key="c" class="flex h-16 w-11 flex-col items-center justify-center rounded-md border bg-white text-[#7a1f2b] shadow-sm" :class="s.playable.includes(c) ? 'border-emerald-500 ring-2 ring-emerald-300' : 'opacity-60'" :disabled="!s.playable.includes(c)" @click="playWhot(c)">
            <span>{{ SHAPE_ICON[card(c).sh] }}</span><b class="text-xs">{{ card(c).n }}</b>
          </button>
        </div>
        <div v-if="shapeFor" class="flex justify-center gap-1">
          <button v-for="sh in ['circle', 'triangle', 'cross', 'square', 'star']" :key="sh" class="rounded-full bg-violet-600 px-2 py-1 text-xs text-white" @click="move({ play: shapeFor, shape: sh }), (shapeFor = null)">{{ SHAPE_ICON[sh] }}</button>
        </div>
        <button v-if="myTurn" class="w-full rounded-full bg-ink py-2 text-xs font-bold text-white" @click="move({ draw: true })">{{ s.pick ? `Pick ${s.pick}` : 'Go to market' }}</button>
        <div class="text-[10px] text-ink/50">{{ s.log.map(logText).join(' · ') }}</div>
      </div>

      <!-- LUDO -->
      <div v-if="m.game === 'ludo' && s" class="space-y-2">
        <div v-for="(pid, seat) in s.players" :key="pid" class="rounded-xl p-2" :style="{ background: COLORS[seat] + '22' }">
          <div class="mb-1 text-[11px] font-bold" :style="{ color: COLORS[seat] }">{{ nm(pid) }}</div>
          <div class="grid grid-cols-4 gap-1">
            <button v-for="(p, i) in s.tokens[pid]" :key="i" class="rounded-lg py-1 text-[10px] font-bold text-white" :style="{ background: COLORS[seat], opacity: seat === s.you && s.movable.includes(i) ? 1 : 0.55 }" :disabled="!(seat === s.you && s.movable.includes(i))" @click="move({ token: i })">
              {{ tokLabel(p) }}
              <div class="mx-auto mt-0.5 h-1 w-10 rounded bg-white/40"><div class="h-1 rounded bg-white" :style="{ width: `${Math.max(0, (p * 100) / 57)}%` }" /></div>
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-2xl font-bold shadow">{{ s.die ?? '–' }}</span>
          <button class="flex-1 rounded-full bg-violet-600 py-2.5 text-sm font-bold text-white disabled:opacity-40" :disabled="!myTurn || s.rolled" @click="move({ roll: true })">Roll</button>
        </div>
        <div class="text-[10px] text-ink/50">{{ s.log.slice(-4).map(logText).join(' · ') }}</div>
      </div>

      <!-- TRIVIA -->
      <div v-if="m.game === 'trivia' && s" class="space-y-2">
        <div class="text-center text-[11px] font-bold">Round {{ Math.min(s.round + 1, s.rounds) }}/{{ s.rounds }}<span v-if="s.question"> · ⏱ {{ Math.ceil(s.question.seconds_left) }}s</span></div>
        <template v-if="s.question">
          <div class="rounded-2xl bg-violet-50 p-3 text-[13px] font-semibold">{{ s.question.q }}</div>
          <button v-for="(o, i) in s.question.options" :key="i" class="block w-full rounded-xl bg-white px-3 py-2 text-left text-xs font-semibold shadow-sm disabled:opacity-50" :disabled="s.answered" @click="move({ answer: i })">{{ o }}</button>
          <div v-if="s.answered" class="text-center text-[11px] text-ink/50">Answer locked in…</div>
        </template>
        <div class="flex flex-wrap justify-center gap-1 text-[11px]">
          <span v-for="(sc, id) in s.scores" :key="id" class="rounded-full bg-ink/5 px-2 font-bold">{{ nm(String(id)) }} {{ sc }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
