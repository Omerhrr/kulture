<script setup lang="ts">
// Phone → Arcade: six original single-player games with an on-screen pad
// (keyboard works too) and server leaderboards.
import { ARCADE_GAMES, makePad, bindKeys, type ArcadeId } from '~/utils/arcade'

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
  unbind()
  unbind = () => {}
  if (playing.value) loadBoard(playing.value)
  playing.value = null
}
onBeforeUnmount(() => unbind())
async function over(n: number) {
  score.value = n
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
      <div class="grid grid-cols-2 gap-2">
        <button v-for="g in ARCADE_GAMES" :key="g.id" class="rounded-2xl bg-gradient-to-br from-ink/[0.04] to-ink/[0.08] p-3 text-left" @click="play(g.id)">
          <div class="text-2xl">{{ g.icon }}</div>
          <div class="text-[13px] font-bold leading-tight">{{ g.name }}</div>
          <div class="text-[10px] text-ink/55">{{ g.blurb }}</div>
          <div v-if="boards[g.id]" class="mt-1 text-[10px] font-bold text-violet-700">
            Best {{ boards[g.id].best }}<span v-if="boards[g.id].leaderboard[0]"> · 👑 {{ boards[g.id].leaderboard[0].name }} {{ boards[g.id].leaderboard[0].score }}</span>
          </div>
        </button>
      </div>
    </template>
    <template v-else>
      <div class="mb-1 flex items-center justify-between text-xs font-bold">
        <span>{{ game?.icon }} {{ game?.name }}<template v-if="online"> · 🌐 vs {{ online.peerName }}</template><template v-else> · {{ score }}</template></span>
        <span class="flex gap-1">
          <button v-if="!online" class="rounded-full bg-ink/10 px-2 py-0.5" @click="play(playing!)">↻</button>
          <button class="rounded-full bg-ink/10 px-2 py-0.5" @click="quit">Exit</button>
        </span>
      </div>
      <component :is="COMPONENTS[playing]" :key="runKey" :pad="pad" :online="online" @score="(n: number) => (score = n)" @over="over" />
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
