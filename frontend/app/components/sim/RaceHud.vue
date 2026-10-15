<script setup lang="ts">
// RaceHud - countdown, timer, checkpoint count and position during a street
// race, then the result card with the leaderboard and any prize.
import { fmtNgn } from '~/utils/format'
import type { RaceState } from '~/utils/raceRoutes'

const race = useState<RaceState>('kk_race')
const now = ref(performance.now())
let raf = 0
onMounted(() => {
  const tick = () => {
    now.value = performance.now()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`
const count = computed(() => Math.ceil((race.value.startAt - now.value) / 1000))
const ORD = ['', '1st', '2nd', '3rd', '4th']
function close() {
  window.dispatchEvent(new CustomEvent('kk-race-cancel'))
}
</script>

<template>
  <div v-if="race && race.phase !== 'idle'" class="pointer-events-none absolute inset-x-0 top-16 z-30 flex flex-col items-center gap-2">
    <div class="pointer-events-auto flex items-center gap-3 rounded-full bg-ink/80 px-4 py-2 text-sm font-bold text-white shadow-lg">
      <span>🏁 {{ race.name }}</span>
      <span v-if="race.phase === 'travel'" class="text-amber-300">Driving to the start…</span>
      <span v-else-if="race.phase === 'board'" class="text-amber-300">Get in your car</span>
      <template v-else-if="race.phase === 'racing' || race.phase === 'done'">
        <span class="tabular-nums">{{ fmt(race.phase === 'done' ? race.ms : race.ms) }}</span>
        <span>CP {{ Math.min(race.cp, race.total) }}/{{ race.total }}</span>
        <span v-if="race.phase === 'done' || race.ms > 0 || race.live?.length" class="text-amber-300">{{ ORD[race.position] ?? race.position + 'th' }}</span>
      </template>
      <button v-if="race.phase !== 'done'" class="rounded-full bg-white/20 px-2 text-xs" @click="close">Quit</button>
    </div>
    <div v-if="race.live?.length" class="pointer-events-auto rounded-2xl bg-ink/70 px-3 py-1.5 text-[11px] font-semibold text-white">
      <div class="text-amber-300">Live racers</div>
      <div v-for="p in race.live" :key="p.name">{{ p.finished ? '🏁' : p.ready ? '🚗' : '⏳' }} {{ p.name }} · CP {{ p.cp }}<span v-if="p.finished"> · {{ fmt(p.ms) }}</span></div>
    </div>
    <div v-if="race.phase === 'countdown' && count > 3" class="rounded-full bg-ink/70 px-4 py-1 text-sm font-bold text-white">Waiting for racers… {{ count }}</div>
    <div v-if="race.phase === 'countdown' && count <= 3" class="font-display text-8xl font-bold text-white drop-shadow-xl">{{ count > 0 ? count : 'GO!' }}</div>
    <div v-if="race.phase === 'done'" class="pointer-events-auto w-[min(340px,90vw)] rounded-3xl bg-white p-4 text-ink shadow-2xl">
      <div class="font-display text-xl font-semibold">{{ race.position === 1 ? '🏆 You won!' : `Finished ${ORD[race.position] ?? race.position + 'th'}` }}</div>
      <div class="text-sm text-ink/60">Time {{ fmt(race.ms) }}<span v-if="race.result?.personal_best"> · personal best!</span></div>
      <div v-if="race.result?.prize" class="mt-1 text-sm font-bold text-emerald-600">Prize {{ fmtNgn(race.result.prize) }}</div>
      <div v-if="race.result?.error" class="mt-1 text-xs text-rose-600">{{ race.result.error }}</div>
      <div v-if="race.result?.leaderboard" class="mt-2 space-y-0.5">
        <div v-for="(r, i) in race.result.leaderboard.slice(0, 5)" :key="i" class="flex justify-between text-xs"><span>{{ i + 1 }}. {{ r.name }}</span><span class="tabular-nums">{{ fmt(r.ms) }}</span></div>
      </div>
      <button class="mt-3 w-full rounded-full bg-ink py-2 text-sm font-bold text-white" @click="close">Done</button>
    </div>
  </div>
</template>
