<script setup lang="ts">
// ShiftCard - on the job: progress to payday, tasks (+15% at 4), leave or
// clock out. Timing and pay are decided by the server.
import { useWorkStore } from '~/stores/work'
import { useSimStore } from '~/stores/sim'
import { fmtNgn } from '~/utils/format'

const work = useWorkStore()
const sim = useSimStore()
const ui = useUiStore()
const now = ref(0)
let t: ReturnType<typeof setInterval> | undefined
onMounted(() => (t = setInterval(() => (now.value = performance.now()), 500)))
onBeforeUnmount(() => clearInterval(t))

const elapsed = computed(() => (void now.value, work.elapsed()))
const req = computed(() => work.shift?.required_seconds ?? 180)
const pct = computed(() => Math.min(1, elapsed.value / req.value))
const done = computed(() => pct.value >= 1)
const left = computed(() => {
  const s = Math.max(0, Math.ceil(req.value - elapsed.value))
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s}s`
})
// one task opens every fifth of the shift (the server enforces the same pace)
const tasksOpen = computed(() => Math.min(4, Math.floor(elapsed.value / Math.max(1, req.value / 5))))
const nextTask = computed(() => work.shift?.tasks[work.shift.tasks_done] ?? null)
const canTask = computed(() => !!work.shift && work.shift.tasks_done < tasksOpen.value)
const payNow = computed(() => Math.round((work.shift?.pay_ngn_minor ?? 0) * (1 + (0.15 * Math.min(4, work.shift?.tasks_done ?? 0)) / 4)))
const collapsed = ref(false)
function rideHome() {
  setTimeout(() => window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'home' } })), 400)
}

async function doTask() {
  try {
    await work.task()
    sim.bump('fun', 3)
    sim.bump('energy', -4)
  } catch (e: any) {
    ui.showToast(e.message, 'info')
  }
}
async function finish() {
  try {
    const r = await work.clockOut()
    if (r.status === 'paid') {
      ui.showToast(`Paid ${fmtNgn(r.paid_ngn_minor)} for your shift as ${r.title}!`, 'success')
      sim.bump('fun', -8)
      sim.bump('energy', -15)
    } else {
      ui.showToast('You left early: no pay this time.', 'info')
    }
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
</script>

<template>
  <div v-if="work.shift" class="pointer-events-auto absolute left-3 top-[4.4rem] z-30 w-[min(340px,86vw)] rounded-3xl bg-ink/75 p-4 text-white shadow-2xl backdrop-blur-md sm:left-4">
    <div class="flex items-start justify-between">
      <div>
        <div class="font-display text-[15px] font-semibold">🏛️ {{ work.shift.title }}</div>
        <div class="text-xs text-white/65">{{ work.career?.place_name }}</div>
      </div>
      <button class="text-white/50 hover:text-white" :aria-label="collapsed ? 'Expand' : 'Collapse'" @click="collapsed = !collapsed">{{ collapsed ? '˅' : '˄' }}</button>
    </div>
    <div class="mt-2.5 flex items-center gap-2">
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20"><div class="h-full rounded-full transition-[width] duration-500" :class="done ? 'bg-leaf' : 'bg-kasand'" :style="{ width: pct * 100 + '%' }" /></div>
      <span class="text-xs font-bold tabular-nums">{{ done ? 'Done!' : left }}</span>
    </div>
    <template v-if="!collapsed">
      <div class="mt-3 flex items-center justify-between">
        <div class="text-sm font-bold">{{ done ? `Payday · ${fmtNgn(payNow)}` : `No pay yet · stay ${left}` }}</div>
        <div class="text-xs text-white/70">⭐ {{ work.shift.tasks_done }}/4 · +15% at 4</div>
      </div>
      <button
        class="mt-3 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-bold transition-colors"
        :class="canTask && nextTask ? 'bg-white text-ink hover:bg-white/90' : 'bg-white/10 text-white/50'"
        :disabled="!canTask || !nextTask"
        @click="doTask"
      >
        <span class="text-lg">🧰</span>
        <span class="flex-1">{{ nextTask ? nextTask : 'All tasks done' }}</span>
        <span v-if="nextTask && !canTask" class="text-[11px] font-semibold">soon</span>
      </button>
    </template>
    <button
      class="mt-3 w-full rounded-full py-3 font-display text-[15px] font-semibold transition-colors"
      :class="done ? 'bg-leaf text-white hover:bg-kadeep' : 'bg-white/15 text-white hover:bg-white/25'"
      :disabled="work.busy"
      @click="finish"
    >
      {{ done ? `Clock out · ${fmtNgn(payNow)}` : 'Leave now · no pay' }}
    </button>
    <button v-if="done" class="mt-2 w-full text-xs font-bold text-white/60 hover:text-white" @click="finish().then(rideHome)">Clock out and ride home ›</button>
  </div>
</template>

