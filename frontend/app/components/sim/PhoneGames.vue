<script setup lang="ts">
// Phone → Games: Whot, Ludo, Ayo and Naija Trivia against real players.
// Lobby: pick a game, then quick match, sit at an open table someone else
// started, invite a friend (head-to-head), or practise against the computer.
// Bots fill empty seats after ~45 s, or straight away with "Start now".
// Optional small stakes in k-sats or sats are escrowed by the server; the
// winner takes the pot. Moves are server-validated; updates arrive live.
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
const tables = ref<any[]>([])
let timer: any = null
let tablesTimer: any = null

const META: Record<string, { icon: string; tint: string; blurb: string }> = {
  whot: { icon: '🃏', tint: 'from-rose-600 to-red-800', blurb: 'Naija card classic. Pick two, hold on, general market!' },
  ludo: { icon: '🎲', tint: 'from-sky-500 to-indigo-700', blurb: 'Race your four seeds home. Sixes, captures, drama.' },
  ayo: { icon: '🥜', tint: 'from-amber-600 to-amber-900', blurb: 'Sow the seeds, capture the twos and threes.' },
  trivia: { icon: '🧠', tint: 'from-violet-500 to-fuchsia-700', blurb: 'Kaduna & Naija quiz. Fast answers score more.' }
}

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
  loadTables()
  tablesTimer = setInterval(() => !m.value && loadTables(), 3000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(tablesTimer)
  window.removeEventListener('kk-ws', onWs)
})
function onWs(ev: Event) {
  const d = (ev as CustomEvent).detail
  if (d?.type === 'game.update' && m.value && d.payload.id === m.value.id) refresh()
}
async function loadTables() {
  try {
    tables.value = (await api.apiGet<any>('/games/tables')).tables
  } catch {}
}
async function refresh() {
  if (!m.value) return
  try {
    m.value = await api.apiGet<any>(`/games/match/${m.value.id}`)
    if (m.value.status === 'done') clearInterval(timer)
  } catch {}
}
function watchMatch() {
  clearInterval(timer)
  timer = setInterval(refresh, 1000)
}
async function join(opts: { vsBots?: boolean; matchId?: string; invite?: string; game?: string }) {
  busy.value = true
  try {
    m.value = await api.apiPost<any>('/games/join', {
      game: opts.game ?? pick.value,
      stake: opts.matchId ? 0 : stake.value,
      asset: asset.value,
      vs_bots: !!opts.vsBots,
      match_id: opts.matchId,
      invite: opts.invite
    })
    watchMatch()
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
async function startNow() {
  try {
    m.value = await api.apiPost<any>(`/games/match/${m.value.id}/start`)
  } catch (e: any) {
    ui.showToast(e.message, 'error')
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
  loadTables()
}

// ---- invite a friend: players online now, or search by name
const inviting = ref(false)
const snap = useState<{ players: Array<{ id: string; name: string }> }>('kk_players', () => ({ online: 0, players: [] }) as any)
const q = ref('')
const found = ref<Array<{ id: string; name: string; username: string }>>([])
let qt: any
watch(q, (v: string) => {
  clearTimeout(qt)
  if (v.trim().length < 2) return void (found.value = [])
  qt = setTimeout(async () => {
    found.value = await api.apiGet<any>(`/wallet/people?q=${encodeURIComponent(v.trim())}`).catch(() => [])
  }, 250)
})
const friends = computed(() => (q.value.trim().length >= 2 ? found.value : (snap.value.players ?? []).slice(0, 8)))
function invite(id: string) {
  inviting.value = false
  join({ invite: id })
}

const names = computed<Record<string, string>>(() => Object.fromEntries((m.value?.players ?? []).map((p: any) => [p.id, p.id === m.value.you ? 'You' : p.name])))
const nm = (id: string) => names.value[id] ?? '?'
const myTurn = computed(() => m.value?.status === 'playing' && m.value.turn === m.value.you)
const s = computed(() => m.value?.state)
const logText = (l: string) => Object.entries(names.value).reduce((t, [id, n]) => t.split(id).join(String(n)), l)
const fmtStake = (v: number) => (asset.value === 'sats_ref' ? `${v} sats` : fmtKsats(v))
const fmtPot = (v: number, a: string) => (a === 'sats_ref' ? `${v} sats` : fmtKsats(v))
const waitLeft = ref(45)
watch(
  () => m.value?.status === 'waiting' && m.value?.created_at,
  () => (waitLeft.value = 45)
)
const waitTimer = setInterval(() => waitLeft.value > 0 && (waitLeft.value -= 1), 1000)
onBeforeUnmount(() => clearInterval(waitTimer))

// ---- whot
const SHAPE_COLOR: Record<string, string> = { circle: '#7a1f2b', triangle: '#7a1f2b', cross: '#7a1f2b', square: '#7a1f2b', star: '#7a1f2b', whot: '#111' }
const card = (c: string) => {
  const [sh, n] = c.split(':')
  return { sh: sh!, n: n! }
}
function playWhot(c: string) {
  if (card(c).n === '20') shapeFor.value = c
  else move({ play: c })
}
const g = computed(() => games.value.find((x: any) => x.id === pick.value))
const openFor = computed(() => tables.value.filter((t: any) => t.game === pick.value))
</script>

<template>
  <div class="space-y-3 text-ink">
    <!-- ================= lobby ================= -->
    <template v-if="!m">
      <!-- game picker -->
      <div class="grid grid-cols-4 gap-1.5">
        <button v-for="x in games" :key="x.id" class="flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-bold transition" :class="pick === x.id ? 'bg-ink text-white' : 'bg-white text-ink/70'" @click="pick = x.id">
          <span class="text-xl">{{ META[x.id]?.icon }}</span>{{ x.name.replace('Naija ', '') }}
        </button>
      </div>
      <div v-if="g" class="rounded-3xl bg-gradient-to-br p-4 text-white shadow-lg" :class="META[g.id]?.tint">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-display text-2xl font-semibold leading-none">{{ g.name }}</div>
            <div class="mt-1 text-xs text-white/80">{{ META[g.id]?.blurb }}</div>
            <div class="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/60">{{ g.seats[0] }}–{{ g.seats[1] }} players</div>
          </div>
          <span class="text-4xl">{{ META[g.id]?.icon }}</span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button class="rounded-2xl bg-white py-2.5 text-sm font-bold text-ink" :disabled="busy" @click="join({})">⚡ Quick match</button>
          <button class="rounded-2xl bg-white/20 py-2.5 text-sm font-bold" :disabled="busy" @click="inviting = !inviting">👥 Invite friend</button>
        </div>
        <button class="mt-2 w-full rounded-2xl bg-black/15 py-2 text-xs font-bold" :disabled="busy" @click="join({ vsBots: true })">Practise vs computer</button>
      </div>

      <!-- invite picker -->
      <div v-if="inviting" class="rounded-2xl bg-white p-3">
        <div class="mb-1.5 text-xs font-bold">Challenge someone to {{ g?.name }}</div>
        <input v-model="q" class="w-full rounded-xl border border-ink/15 px-3 py-2 text-sm" placeholder="Search name or @username" />
        <div v-if="!friends.length" class="mt-2 text-[11px] text-ink/45">{{ q.trim().length >= 2 ? 'No players match.' : 'Nobody nearby right now - search by name.' }}</div>
        <button v-for="f in friends" :key="f.id" class="mt-1 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-ink/5" @click="invite(f.id)">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-kadeep text-xs font-bold text-white">{{ f.name.charAt(0) }}</span>
          <span class="flex-1 text-sm font-semibold">{{ f.name }}</span>
          <span class="kk-chip">Invite</span>
        </button>
      </div>

      <!-- stake -->
      <div class="rounded-2xl bg-white p-3">
        <div class="mb-1.5 flex items-center justify-between text-xs font-bold">
          <span>Stake <span class="font-semibold text-ink/45">· winner takes the pot</span></span>
          <span class="flex gap-1">
            <button class="rounded-full px-2" :class="asset === 'ksats' ? 'bg-ink text-white' : 'bg-ink/5'" @click="(asset = 'ksats'), (stake = 0)">ks</button>
            <button class="rounded-full px-2" :class="asset === 'sats_ref' ? 'bg-amber-500 text-white' : 'bg-ink/5'" @click="(asset = 'sats_ref'), (stake = 0)">⚡ sats</button>
          </span>
        </div>
        <div class="flex flex-wrap gap-1">
          <button v-for="v in (asset === 'ksats' ? [0, 10000, 50000, 100000, 500000] : [0, 21, 100, 500, 1000])" :key="v" class="rounded-full px-2.5 py-1 text-[11px] font-bold" :class="stake === v ? 'bg-violet-600 text-white' : 'bg-ink/5'" @click="stake = v">{{ v ? fmtStake(v) : 'Free' }}</button>
        </div>
      </div>

      <!-- open tables -->
      <div>
        <div class="mb-1 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-widest text-ink/40">
          <span>Open tables</span><span class="normal-case tracking-normal">{{ tables.length }} waiting</span>
        </div>
        <div v-if="!tables.length" class="rounded-2xl bg-white p-3 text-xs text-ink/50">No tables waiting. Start one with Quick match - others see it here.</div>
        <div v-for="t in [...openFor, ...tables.filter((x: any) => x.game !== pick)]" :key="t.id" class="mb-1.5 flex items-center gap-2.5 rounded-2xl bg-white p-2.5">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br text-xl text-white" :class="META[t.game]?.tint">{{ META[t.game]?.icon }}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-bold">{{ t.host }}'s {{ t.name }}</div>
            <div class="text-[11px] text-ink/50">{{ t.players.length }}/{{ t.seats[1] }} seated{{ t.stake ? ` · stake ${fmtPot(t.stake, t.asset)}` : '' }} · bots in {{ t.bots_in }}s</div>
          </div>
          <button class="kk-btn-primary !px-3 !py-1.5 text-xs" :disabled="busy" @click="join({ matchId: t.id, game: t.game })">Sit</button>
        </div>
      </div>
    </template>

    <!-- ================= table ================= -->
    <template v-else>
      <div class="flex items-center gap-2">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-lg text-white" :class="META[m.game]?.tint">{{ META[m.game]?.icon }}</span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold">{{ m.name }}</div>
          <div class="text-[11px] text-ink/50">{{ m.players.map((p: any) => (p.id === m.you ? 'You' : p.name + (p.bot ? ' 🤖' : ''))).join(' · ') }}</div>
        </div>
        <span v-if="m.stake" class="kk-chip text-amber-700">pot {{ fmtPot(m.stake * m.players.length, m.asset) }}</span>
        <button class="rounded-full bg-ink/10 px-2.5 py-1 text-xs font-bold" @click="leave">{{ m.status === 'done' ? 'Close' : 'Leave' }}</button>
      </div>

      <div v-if="m.status === 'waiting'" class="rounded-2xl bg-white p-4 text-center">
        <template v-if="m.invite">
          <div class="text-3xl">⏳</div>
          <div class="mt-1 text-sm font-bold">Waiting for your friend to accept…</div>
          <div class="text-xs text-ink/50">The invite lasts 3 minutes; any stake comes back if they don't come.</div>
        </template>
        <template v-else>
          <div class="text-sm font-bold">{{ m.players.length }} at the table</div>
          <div class="text-xs text-ink/50">Others can sit from Open tables. Bots fill the empty seats in {{ waitLeft }}s.</div>
          <button class="kk-btn-primary mt-3 w-full" @click="startNow">Start now with bots</button>
        </template>
      </div>
      <div v-else-if="m.status === 'done'" class="rounded-2xl p-3 text-center text-sm font-bold" :class="m.winner === m.you ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'">
        {{ m.winner === m.you ? '🏆 You won!' + (m.stake ? ' The pot is yours.' : '') : m.winner ? `${nm(m.winner)} won` : 'Draw' }}
      </div>
      <div v-else class="rounded-full py-1.5 text-center text-xs font-bold" :class="myTurn ? 'bg-emerald-600 text-white' : 'bg-ink/5 text-ink/55'">
        {{ m.game === 'trivia' ? 'Answer fast for bonus points' : myTurn ? 'Your turn' : `${nm(m.turn)}'s turn…` }}
      </div>

      <!-- AYO -->
      <div v-if="m.game === 'ayo' && s" class="rounded-3xl bg-gradient-to-b from-[#8b5a2b] to-[#5c3a1a] p-3 text-white shadow-lg">
        <div class="mb-1.5 text-center text-[11px] font-bold text-white/80">{{ nm(s.players[1 - Math.max(0, s.you)]) }} · store {{ s.store[1 - Math.max(0, s.you)] }}</div>
        <div v-for="row in (s.you === 1 ? [[0,1,2,3,4,5].reverse(), [6,7,8,9,10,11]] : [[6,7,8,9,10,11].reverse(), [0,1,2,3,4,5]])" :key="row[0]" class="grid grid-cols-6 gap-1.5 py-1">
          <button v-for="p in row" :key="p" class="relative flex aspect-square items-center justify-center rounded-full shadow-inner" :class="s.legal.includes(p) ? 'bg-[#3d2410] ring-2 ring-amber-300' : 'bg-[#3d2410]'" :disabled="!s.legal.includes(p)" @click="move(p)">
            <span class="flex flex-wrap items-center justify-center gap-[2px] p-1">
              <span v-for="k in Math.min(s.pits[p], 8)" :key="k" class="h-1.5 w-1.5 rounded-full bg-amber-200" />
            </span>
            <span class="absolute -bottom-1 rounded-full bg-black/50 px-1 text-[9px] font-bold">{{ s.pits[p] }}</span>
          </button>
        </div>
        <div class="mt-1.5 text-center text-[11px] font-bold text-white/80">You · store {{ s.store[Math.max(0, s.you)] }}</div>
      </div>

      <!-- WHOT -->
      <div v-if="m.game === 'whot' && s" class="space-y-2.5 rounded-3xl bg-gradient-to-b from-emerald-700 to-emerald-900 p-3">
        <div class="flex flex-wrap justify-center gap-1 text-[10px] font-bold text-white/85">
          <span v-for="(n, id) in s.counts" :key="id" class="rounded-full bg-black/20 px-2 py-0.5">{{ nm(String(id)) }} · {{ n }} 🂠</span>
        </div>
        <div class="flex items-center justify-center gap-4">
          <div class="flex h-24 w-16 flex-col items-center justify-center rounded-xl border-2 border-white/80 bg-[#7a1f2b] text-white shadow-lg">
            <span class="font-display text-lg font-bold">WHOT</span><span class="text-[10px]">market {{ s.deck }}</span>
          </div>
          <WhotCard :shape="card(s.top).sh" :num="card(s.top).n" big />
        </div>
        <div v-if="s.want" class="text-center text-xs font-bold text-amber-200">I need: {{ s.want }}</div>
        <div v-if="s.pick" class="text-center text-xs font-bold text-rose-200">Pick {{ s.pick }}!</div>
        <div class="flex flex-wrap justify-center gap-1.5">
          <button v-for="c in s.hand" :key="c" class="transition" :class="s.playable.includes(c) && myTurn ? '-translate-y-1' : 'opacity-60'" :disabled="!s.playable.includes(c)" @click="playWhot(c)">
            <WhotCard :shape="card(c).sh" :num="card(c).n" :glow="s.playable.includes(c) && myTurn" />
          </button>
        </div>
        <div v-if="shapeFor" class="flex justify-center gap-1.5">
          <button v-for="sh in ['circle', 'triangle', 'cross', 'square', 'star']" :key="sh" @click="move({ play: shapeFor, shape: sh }), (shapeFor = null)"><WhotCard :shape="sh" num="" /></button>
        </div>
        <button v-if="myTurn" class="w-full rounded-full bg-white py-2 text-xs font-bold text-emerald-900" @click="move({ draw: true })">{{ s.pick ? `Pick ${s.pick}` : 'Go to market' }}</button>
        <div class="text-center text-[10px] text-white/60">{{ s.log.slice(-3).map(logText).join(' · ') }}</div>
      </div>

      <!-- LUDO -->
      <div v-if="m.game === 'ludo' && s" class="space-y-2">
        <LudoBoard :players="s.players" :tokens="s.tokens" :you="s.you" :movable="s.movable" :names="names" @move="(i: number) => move({ token: i })" />
        <div class="flex items-center gap-2">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-3xl shadow">{{ ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][(s.die ?? 1) - 1] ?? '–' }}</span>
          <button class="flex-1 rounded-full bg-violet-600 py-3 text-sm font-bold text-white disabled:opacity-40" :disabled="!myTurn || s.rolled" @click="move({ roll: true })">{{ myTurn && s.rolled ? 'Tap a glowing seed' : 'Roll' }}</button>
        </div>
        <div class="text-center text-[10px] text-ink/50">{{ s.log.slice(-3).map(logText).join(' · ') }}</div>
      </div>

      <!-- TRIVIA -->
      <div v-if="m.game === 'trivia' && s" class="space-y-2">
        <div class="flex items-center justify-between text-[11px] font-bold">
          <span>Round {{ Math.min(s.round + 1, s.rounds) }}/{{ s.rounds }}</span>
          <span v-if="s.question" class="rounded-full bg-violet-600 px-2 py-0.5 text-white">⏱ {{ Math.ceil(s.question.seconds_left) }}s</span>
        </div>
        <template v-if="s.question">
          <div class="rounded-3xl bg-gradient-to-br from-violet-600 to-fuchsia-700 p-4 text-[15px] font-semibold leading-snug text-white shadow">{{ s.question.q }}</div>
          <button v-for="(o, i) in s.question.options" :key="i" class="flex w-full items-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-left text-sm font-semibold shadow-sm disabled:opacity-50" :disabled="s.answered" @click="move({ answer: i })">
            <span class="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">{{ 'ABCD'[i] }}</span>{{ o }}
          </button>
          <div v-if="s.answered" class="text-center text-[11px] text-ink/50">Answer locked in…</div>
        </template>
        <div class="flex flex-wrap justify-center gap-1 text-[11px]">
          <span v-for="(sc, id) in s.scores" :key="id" class="rounded-full bg-white px-2.5 py-0.5 font-bold shadow-sm">{{ nm(String(id)) }} {{ sc }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
