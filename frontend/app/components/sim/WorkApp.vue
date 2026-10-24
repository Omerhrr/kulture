<script setup lang="ts">
// WorkApp - Phone → Work: pick a career, see pay and hours, and go to work
// (starts the automatic commute). Shows your last payslip.
import { useWorkStore } from '~/stores/work'
import { fmtKsats } from '~/utils/format'

const open = useState<boolean>('kk_work_open', () => false)
const work = useWorkStore()
const ui = useUiStore()
const playerPos = useState<[number, number, number]>('kk_player_pos')
const ICONS: Record<string, string> = { developer: '💻', banker: '🏦', doctor: '🩺', manager: '📊', shop: '🏪', textile: '🧵', motorpark: '🚌', campus: '🎓', rail: '🚆' }

watch(open, async (o) => {
  if (!o) return
  try {
    await work.refresh()
  } catch (e: any) {
    ui.showToast(e.message || 'Could not load jobs', 'error')
  }
})
const dist = (c: { position: [number, number, number] | null }) => {
  if (!c.position) return 'clock in anywhere in town'
  const d = Math.hypot(c.position[0] - playerPos.value[0], c.position[2] - playerPos.value[2])
  return d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`
}
const mins = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`)

function go() {
  open.value = false
  window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'work' } }))
}
</script>

<template>
  <transition enter-active-class="transition duration-300 ease-out" enter-from-class="translate-y-8 opacity-0">
    <div v-if="open" class="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/30 sm:items-center" @click.self="open = false">
      <div class="flex max-h-[90dvh] w-[min(520px,100vw)] flex-col rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
        <div class="flex items-center gap-3 px-6 pb-2 pt-5">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-2xl">💼</span>
          <div class="flex-1">
            <div class="font-display text-xl font-semibold text-ink">Work</div>
            <div class="text-sm text-ink/55">Clock in on site, stay the shift, get paid.</div>
          </div>
          <button class="kk-close" aria-label="Close" @click="open = false">✕</button>
        </div>

        <div v-if="work.lastResult" class="mx-6 mt-2 rounded-2xl px-4 py-3 text-sm" :class="work.lastResult.status === 'paid' ? 'bg-leaf/10 text-leaf' : 'bg-amber-50 text-amber-700'">
          <b>Last shift:</b> {{ work.lastResult.title }} ·
          {{ work.lastResult.status === 'paid' ? `paid ${fmtKsats(work.lastResult.paid_ksats)}` : 'left early, no pay' }}
        </div>

        <div class="kk-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 py-4">
          <button
            v-for="c in work.careers"
            :key="c.id"
            class="flex w-full items-center gap-3.5 rounded-3xl border-2 p-3.5 text-left transition-colors"
            :class="work.careerId === c.id ? 'border-leaf bg-leaf/10' : 'border-transparent bg-ink/[0.04] hover:bg-ink/[0.07]'"
            @click="work.choose(c.id)"
          >
            <span class="text-3xl">{{ ICONS[c.id] ?? '💼' }}</span>
            <div class="min-w-0 flex-1">
              <div class="font-display text-[15px] font-semibold text-ink">{{ c.title }}</div>
              <div class="truncate text-xs text-ink/55">{{ c.place_name }} · {{ dist(c) }}</div>
              <div v-if="c.needs_certificate" class="text-[10px] font-bold text-violet-600">🎓 {{ c.needs_certificate === 'any' ? 'Needs any school certificate' : `Needs a ${c.needs_certificate.replace('_', ' ')} certificate` }}</div>
            </div>
            <div class="text-right">
              <div class="text-sm font-extrabold text-leaf">{{ fmtKsats(c.pay_ksats) }}</div>
              <div class="text-[11px] text-ink/45">per {{ mins(c.shift_seconds) }} shift</div>
            </div>
          </button>
          <p class="px-1 pt-1 text-[11px] leading-relaxed text-ink/45">
            The server times your shift and checks you're on site when you clock in and out. Finish small tasks for up to +15%. Pay is in k-sats (game money), never Bitcoin.
          </p>
        </div>
        <div class="border-t border-ink/5 p-4">
          <button v-if="work.shift" class="w-full rounded-full bg-ink/10 py-4 font-display text-lg font-semibold text-ink" @click="open = false">You're on a shift</button>
          <button v-else class="w-full rounded-full py-4 font-display text-lg font-semibold text-white shadow-lg transition-colors" :class="work.careerId ? 'bg-leaf shadow-leaf/30 hover:bg-kadeep' : 'bg-leaf/35'" :disabled="!work.careerId" @click="go">
            {{ work.career ? (work.career.position ? `Go to work · ${work.career.place_name}` : `Log in · ${work.career.title}`) : 'Pick a job' }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>
