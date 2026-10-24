<script setup lang="ts">
// Tour - a 7-step first-run walkthrough. Each step spotlights a real HUD
// element (by data-tour attribute) and the card sits away from it.
import { useSimStore } from '~/stores/sim'

const sim = useSimStore()
const askOpen = useState<boolean>('kk_ask_open', () => false)
const STEPS = [
  { icon: '👋', title: 'Welcome to Kaduna!', text: 'Quick tour, under one minute. Oya!', target: null },
  { icon: '🍲', title: 'Your needs', text: 'Keep them green: eat, sleep, baff. Tap them for details.', target: 'needs' },
  { icon: '🙂', title: 'Your mood', text: 'Happy Sims work better. Mood comes from your needs.', target: 'mood' },
  { icon: '💰', title: 'Your money', text: 'k-sats are game money: work to earn them, or deposit Lightning sats (1 sat = 1,000 k-sats).', target: 'money' },
  { icon: '🏠', title: 'Home', text: 'Tap Home to go to your place. Use the fridge, bed and shower.', target: 'dock-home' },
  { icon: '⚡', title: 'Buy with Lightning', text: 'Buy opens the shop. Pay real sats; the server verifies every payment.', target: 'dock-buy' },
  { icon: '📱', title: 'Your phone', text: 'Jobs, wallet, maps, settings and help all live here.', target: 'dock-phone' },
  { icon: '✨', title: 'Stuck? Ask!', text: 'Phone → Ask, any time.', target: null }
]
const i = ref(0)
const rect = ref<DOMRect | null>(null)
const step = computed(() => STEPS[i.value])
function measure() {
  const t = step.value.target
  const el = t ? document.querySelector<HTMLElement>(`[data-tour="${t}"]`) : null
  rect.value = el && el.offsetParent !== null ? el.getBoundingClientRect() : null
}
watch(i, () => nextTick(measure))
onMounted(() => {
  nextTick(measure)
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))
function finish(ask = false) {
  sim.tourDone = true
  sim.save()
  if (ask) askOpen.value = true
}
// keep the card on the opposite half from the spotlight
const cardStyle = computed(() => {
  const r = rect.value
  if (!r) return { top: '50%', transform: 'translate(-50%, -50%)' }
  const below = r.top + r.height / 2 < window.innerHeight / 2
  return below ? { top: `${Math.min(r.bottom + 18, window.innerHeight - 220)}px`, transform: 'translateX(-50%)' } : { bottom: `${window.innerHeight - r.top + 18}px`, transform: 'translateX(-50%)' }
})
</script>

<template>
  <div class="pointer-events-auto absolute inset-0 z-50" role="dialog" aria-modal="true" :aria-label="step.title">
    <!-- dim with a spotlight hole -->
    <div
      v-if="rect"
      class="absolute rounded-[1.6rem] ring-4 ring-white/90 transition-all duration-300"
      :style="{ left: rect.left - 6 + 'px', top: rect.top - 6 + 'px', width: rect.width + 12 + 'px', height: rect.height + 12 + 'px', boxShadow: '0 0 0 9999px rgba(20,28,24,0.45)' }"
    />
    <div v-else class="absolute inset-0 bg-[rgba(20,28,24,0.45)]" />

    <div class="absolute left-1/2 w-[min(560px,92vw)] rounded-[2rem] bg-white p-5 shadow-2xl transition-all duration-300 sm:p-6" :style="cardStyle">
      <div class="flex items-center gap-4">
        <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-paper text-3xl">{{ step.icon }}</span>
        <div>
          <div class="font-display text-xl font-semibold text-ink">{{ step.title }}</div>
          <div class="text-[15px] text-ink/60">{{ step.text }}</div>
        </div>
      </div>
      <div class="my-4 flex justify-center gap-1.5">
        <span v-for="(s, n) in STEPS" :key="n" class="h-2 rounded-full transition-all" :class="n === i ? 'w-7 bg-leaf' : 'w-2 bg-ink/15'" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <button v-if="i < STEPS.length - 1" class="rounded-full py-3.5 font-bold text-ink/60 hover:bg-ink/5" @click="finish()">Skip</button>
        <button v-else class="rounded-full bg-paper py-3.5 font-bold text-ink hover:bg-ink/5" @click="finish(true)">Ask ✨</button>
        <button class="rounded-full bg-leaf py-3.5 font-display text-lg font-semibold text-white shadow-lg shadow-leaf/30 hover:bg-kadeep" @click="i < STEPS.length - 1 ? i++ : finish()">
          {{ i === 0 ? 'Start' : i < STEPS.length - 1 ? 'Next' : 'Done' }}
        </button>
      </div>
    </div>
  </div>
</template>
