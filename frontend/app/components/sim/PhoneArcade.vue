<script setup lang="ts">
// Phone → Arcade: six original single-player games with an on-screen pad
// (keyboard works too) and server leaderboards.
import { ARCADE_GAMES, makePad, bindKeys, type ArcadeId } from '~/utils/arcade'
import { DUEL_GAMES, duelSend, useDuel } from '~/composables/useDuel'

const api = useGameApi()
const playing = ref<ArcadeId | null>(null)
const pad = reactive(makePad())
const score = ref(0)
const result = ref<any>(null)
const boards = ref<Record<string, any>>({})
const runKey = ref(0)
let unbind = () => {}
// live head-to-head Street Brawl with a friend (set up by SocialNotices)
const fight = useState<{ peer: string; peerName: string; host: boolean; ready: boolean } | null>('kk_fight', () => null)
const online = computed(() => (playing.value === 'brawl' && fight.value?.ready ? { peer: fight.value.peer, peerName: fight.value.peerName, host: fight.value.host } : null))
watch(
  () => fight.value?.ready,
  (r) => r && play('brawl'),
  { immediate: true }
)

const COMPONENTS: Record<string, any> = {
  snake: resolveComponent('ArcadeSnake'),
  runner: resolveComponent('ArcadeRunner'),
  brawl: resolveComponent('ArcadeBrawl'),
  stick: resolveComponent('ArcadeStick'),
  okada: resolveComponent('ArcadeOkada'),
  blocks: resolveComponent('ArcadeBlocks')
}
const HELP: Record<string, string> = {
  snake: 'Arrows / swipe to turn',
  runner: '◀ ▶ run · A jump (hold for higher)',
  brawl: 'A punch · B kick · ▼ block · ▲ jump · ▼+A fireball when the bar is full',
  stick: 'A swing · B dash · ▲ jump (twice in the air)',
  okada: '◀ ▶ or swipe to change lane · grab ⛽',
  blocks: '◀ ▶ move · A rotate · ▼ faster · B drop'
}

const TINT: Record<string, string> = {
  snake: 'from-lime-500 to-emerald-700', runner: 'from-sky-500 to-blue-700', brawl: 'from-rose-500 to-red-800',
  stick: 'from-slate-500 to-slate-800', okada: 'from-amber-500 to-orange-700', blocks: 'from-violet-500 to-indigo-800'
}

// ---- duels (live head-to-head on the score games)
const player = usePlayerStore()
const duel = useDuel()
const picking = ref<ArcadeId | null>(null)
const snap = useState<{ players: Array<{ id: string; name: string }> }>('kk_players', () => ({ online: 0, players: [] }) as any)
const q = ref('')
const found = ref<Array<{ id: string; name: string }>>([])
let qt: any
watch(q, (v: string) => {
  clearTimeout(qt)
  if (v.trim().length < 2) return void (found.value = [])
  qt = setTimeout(async () => (found.value = await api.apiGet<any>(`/wallet/people?q=${encodeURIComponent(v.trim())}`).catch(() => [])), 250)
})
const people = computed(() => (q.value.trim().length >= 2 ? found.value : (snap.value.players ?? []).slice(0, 8)))
function challenge(to: { id: string; name: string }) {
  const g = ARCADE_GAMES.find((x) => x.id === picking.value)!
  duel.value = { peer: to.id, peerName: to.name, game: g.id, host: true, phase: 'invite', me: { score: 0, over: false }, them: { score: 0, over: false } }
  duelSend(to.id, { k: 'duel_invite', game: g.id, title: `${g.icon} ${g.name}`, name: player.profile?.display_name ?? 'Friend' })
  picking.value = null
  setTimeout(() => {
    if (duel.value?.phase === 'invite' && duel.value.peer === to.id && duel.value.host) duel.value = null
  }, 45000)
}
const inDuel = computed(() => duel.value?.phase === 'playing' || duel.value?.phase === 'done')
watch(
  () => duel.value?.phase,
  (p: string | undefined) => p === 'playing' && duel.value && play(duel.value.game as ArcadeId),
  { immediate: true }
)
let lastTick = 0
function onScore(n: number) {
  score.value = n
  const d = duel.value
  if (d?.phase === 'playing' && !d.me.over) {
    d.me.score = n
    const now = performance.now()
    if (now - lastTick > 700) {
      lastTick = now
      duelSend(d.peer, { k: 'duel_score', s: n })
    }
  }
}
function quitDuel() {
  if (duel.value) duelSend(duel.value.peer, { k: 'duel_quit' })
  duel.value = null
}
const verdict = computed(() => {
  const d = duel.value
  if (!d || d.phase !== 'done') return ''
  return d.me.score > d.them.score ? '🏆 You win the duel!' : d.me.score < d.them.score ? `${d.peerName} wins this one` : "It's a draw!"
})

async function loadBoard(id: string) {
  try {
    boards.value[id] = await api.apiGet<any>(`/arcade/${id}`)
  } catch {}
}
onMounted(() => ARCADE_GAMES.forEach((g) => loadBoard(g.id)))

function play(id: ArcadeId) {
  playing.value = id
  score.value = 0
  result.value = null
  runKey.value++
  unbind()
  unbind = bindKeys(pad as any)
}
function quit() {
  fight.value = null
  if (duel.value) quitDuel()
  unbind()
  unbind = () => {}
  if (playing.value) loadBoard(playing.value)
  playing.value = null
}
onBeforeUnmount(() => unbind())
async function over(n: number) {
  score.value = n
  const d = duel.value
  if (d?.phase === 'playing') {
    duelSend(d.peer, { k: 'duel_over', s: n })
    duel.value = { ...d, me: { score: n, over: true }, phase: d.them.over ? 'done' : 'playing' }
  }
  if (online.value) return (result.value = { error: n ? 'You won the head-to-head! 🥊' : 'Good fight - ask for a rematch in chat.' })
  try {
    result.value = await api.apiPost<any>('/arcade/score', { game: playing.value, score: n })
  } catch (e: any) {
    result.value = { error: e.message }
  }
}
// on-screen pad: hold = held, tap = one press
function press(k: 'left' | 'right' | 'up' | 'down' | 'a' | 'b', on: boolean) {
  if (on && !(pad as any)[k]) pad.pressed.add(k)
  ;(pad as any)[k] = on
}
const game = computed(() => ARCADE_GAMES.find((g) => g.id === playing.value))
</script>

<template>
  <div class="text-ink">
    <template v-if="!playing">
      <div v-if="duel?.phase === 'invite' && duel.host" class="mb-2 flex items-center justify-between rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
        ⚔️ Waiting for {{ duel.peerName }} to accept…
        <button class="rounded-full bg-white px-2 py-0.5" @click="duel = null">Cancel</button>
      </div>
      <div v-if="picking" class="mb-2 rounded-2xl bg-white p-3">
        <div class="mb-1.5 flex items-center justify-between text-xs font-bold">
          <span>⚔️ Duel someone at {{ ARCADE_GAMES.find((g) => g.id === picking)?.name }}</span>
          <button class="text-ink/45" @click="picking = null">✕</button>
        </div>
        <input v-model="q" class="w-full rounded-xl border border-ink/15 px-3 py-2 text-sm" placeholder="Search name or @username" />
        <div v-if="!people.length" class="mt-2 text-[11px] text-ink/45">{{ q.trim().length >= 2 ? 'No players match.' : 'Nobody nearby - search by name.' }}</div>
        <button v-for="p in people" :key="p.id" class="mt-1 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-ink/5" @click="challenge(p)">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-kadeep text-xs font-bold text-white">{{ p.name.charAt(0) }}</span>
          <span class="flex-1 text-sm font-semibold">{{ p.name }}</span>
          <span class="kk-chip">Challenge</span>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div v-for="g in ARCADE_GAMES" :key="g.id" class="overflow-hidden rounded-3xl bg-white shadow-sm">
          <button class="block w-full bg-gradient-to-br p-3 text-left text-white" :class="TINT[g.id]" @click="play(g.id)">
            <div class="text-3xl drop-shadow">{{ g.icon }}</div>
            <div class="mt-1 text-[13px] font-bold leading-tight">{{ g.name }}</div>
            <div class="line-clamp-2 text-[10px] text-white/80">{{ g.blurb }}</div>
          </button>
          <div class="flex items-center justify-between px-2.5 py-1.5">
            <span class="truncate text-[10px] font-bold text-ink/55">{{ boards[g.id]?.leaderboard?.[0] ? `👑 ${boards[g.id].leaderboard[0].name} ${boards[g.id].leaderboard[0].score}` : 'No record yet' }}</span>
            <button v-if="DUEL_GAMES.includes(g.id)" class="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-white" @click="picking = g.id">⚔️ Duel</button>
          </div>
        </div>
      </div>
      <p class="mt-2 text-center text-[10px] text-ink/45">Street Brawl: challenge a contact from Chats for a live fight.</p>
    </template>
    <template v-else>
      <div class="mb-1 flex items-center justify-between text-xs font-bold">
        <span>{{ game?.icon }} {{ game?.name }}<template v-if="online"> · 🌐 vs {{ online.peerName }}</template><template v-else> · {{ score }}</template></span>
        <span class="flex gap-1">
          <button v-if="!online && !inDuel" class="rounded-full bg-ink/10 px-2 py-0.5" @click="play(playing!)">↻</button>
          <button class="rounded-full bg-ink/10 px-2 py-0.5" @click="quit">Exit</button>
        </span>
      </div>
      <div v-if="inDuel && duel" class="mb-1.5 rounded-2xl bg-ink p-2 text-white">
        <div class="flex items-center justify-between text-[11px] font-bold">
          <span>You {{ duel.me.score }}{{ duel.me.over ? ' ✓' : '' }}</span>
          <span class="text-white/50">⚔️ duel</span>
          <span>{{ duel.peerName }} {{ duel.them.score }}{{ duel.them.over ? ' ✓' : '' }}</span>
        </div>
        <div class="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/15">
          <div class="bg-emerald-400 transition-all" :style="{ width: `${(100 * duel.me.score) / Math.max(1, duel.me.score + duel.them.score)}%` }" />
          <div class="flex-1 bg-rose-400" />
        </div>
        <div v-if="verdict" class="mt-1.5 text-center text-sm font-bold">{{ verdict }}</div>
        <div v-else-if="duel.me.over" class="mt-1 text-center text-[11px] text-white/70">Waiting for {{ duel.peerName }} to finish…</div>
      </div>
      <component :is="COMPONENTS[playing]" :key="runKey" :pad="pad" :online="online" @score="onScore" @over="over" />
      <div class="mt-1 text-center text-[10px] text-ink/50">{{ HELP[playing] }}</div>
      <div v-if="result" class="mt-1 rounded-xl bg-violet-50 p-2 text-[11px]">
        <div class="font-bold text-violet-700">{{ result.error ?? (result.new_best ? `New best: ${result.best}! 🎉` : `Best: ${result.best}`) }}</div>
        <div v-for="(r, i) in (result.leaderboard ?? []).slice(0, 5)" :key="i" class="flex justify-between"><span>{{ i + 1 }}. {{ r.name }}</span><span>{{ r.score }}</span></div>
      </div>
      <!-- pad -->
      <div class="mt-2 flex select-none items-center justify-between">
        <div class="grid grid-cols-3 gap-1">
          <span />
          <button class="h-10 w-10 rounded-lg bg-ink/80 text-white" @pointerdown.prevent="press('up', true)" @pointerup="press('up', false)" @pointerleave="press('up', false)">▲</button>
          <span />
          <button class="h-10 w-10 rounded-lg bg-ink/80 text-white" @pointerdown.prevent="press('left', true)" @pointerup="press('left', false)" @pointerleave="press('left', false)">◀</button>
          <button class="h-10 w-10 rounded-lg bg-ink/80 text-white" @pointerdown.prevent="press('down', true)" @pointerup="press('down', false)" @pointerleave="press('down', false)">▼</button>
          <button class="h-10 w-10 rounded-lg bg-ink/80 text-white" @pointerdown.prevent="press('right', true)" @pointerup="press('right', false)" @pointerleave="press('right', false)">▶</button>
        </div>
        <div class="flex gap-2">
          <button class="h-12 w-12 rounded-full bg-rose-600 font-bold text-white" @pointerdown.prevent="press('b', true)" @pointerup="press('b', false)" @pointerleave="press('b', false)">B</button>
          <button class="h-12 w-12 -translate-y-3 rounded-full bg-emerald-600 font-bold text-white" @pointerdown.prevent="press('a', true)" @pointerup="press('a', false)" @pointerleave="press('a', false)">A</button>
        </div>
      </div>
    </template>
  </div>
</template>
