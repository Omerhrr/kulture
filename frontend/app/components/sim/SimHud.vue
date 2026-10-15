<script setup lang="ts">
import { calendarDate } from '~/utils/lifeShared'
// SimHud - the life-sim layer of the HUD:
//   top centre : day + time | mood | weather | money (+ to earn)
//   bottom left: portrait + six need bars (hover/tap for details)
//   top left   : "what now" goal chip from the most urgent need
//   clean screen toggle hides everything but the world
import { useSimStore, NEEDS } from '~/stores/sim'
import { useWorkStore } from '~/stores/work'
import { useClock, formatHour } from '~/composables/useTimeOfDay'
import { fireKkEvent, useRide, useInterior } from '~/composables/useControlsState'

const sim = useSimStore()
const work = useWorkStore()
const online = computed(() => Math.max(1, useState<{ online: number }>('kk_players', () => ({ online: 0, players: [] })).value.online))
const player = usePlayerStore()
const ui = useUiStore()
const hour = useClock()
const ride = useRide()
const interior = useInterior()
const weatherLabel = useState<string>('kk_weather_label', () => '☀️ Sunny')
const emit = defineEmits<{ (e: 'settings'): void }>()

// game-day counter for "Mon 12"-style date (starts on today's real date)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const gameDay = useState<number>('kk_day', () => 1) // advanced by DayNight at midnight
watch(hour, (h) => sim.tick(h))
const dateLabel = computed(() => {
  const d = calendarDate(gameDay.value)
  return `${DAYS[d.getDay()]} ${d.getDate()}`
})

// small life-sim couplings: talking is social, riding around is fun
watch(
  () => ui.dialogue,
  (d) => d && sim.bump('social', 12)
)
let funT: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  funT = setInterval(() => {
    if (ride.value.active && ride.value.speed > 2) sim.bump('fun', 1.2)
  }, 2000)
  // persist needs now and then
  const s = setInterval(() => sim.save(), 15000)
  onBeforeUnmount(() => clearInterval(s))
})
onBeforeUnmount(() => clearInterval(funT))

const barTone = (v: number) => (v > 55 ? 'bg-leaf' : v > 28 ? 'bg-amber-500' : 'bg-red-500')
const moodTone = computed(() => (sim.mood.tone === 'good' ? 'text-leaf' : sim.mood.tone === 'ok' ? 'text-amber-600' : 'text-red-600'))
const showNeeds = ref(false)

const urgentInfo = computed(() => {
  const k = sim.urgent
  if (!k) return null
  const n = NEEDS.find((x) => x.key === k)!
  const verb: Record<string, string> = {
    hunger: 'Eat something',
    energy: 'Get some sleep',
    fun: 'Have some fun',
    social: 'Talk to someone',
    hygiene: 'Take a baff',
    bladder: 'Find a toilet'
  }
  return { icon: n.icon, title: verb[k], hint: interior.value.inside ? n.hint : `Tap Home, then: ${n.hint.toLowerCase()}` }
})
const initials = computed(() => (sim.name || player.profile?.display_name || '?').charAt(0).toUpperCase())
</script>

<template>
  <!-- clean screen: only a restore pill -->
  <button
    v-if="sim.cleanScreen"
    class="pointer-events-auto absolute right-3 top-3 z-30 rounded-full bg-white/85 px-3.5 py-2 text-xs font-bold text-ink shadow-lg backdrop-blur"
    @click="sim.cleanScreen = false"
  >
    ˅ Show HUD
  </button>
  <template v-else>
    <!-- top centre status bar -->
    <div class="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-2.5 sm:p-3">
      <div data-tour="status" class="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-ink/10 bg-white/90 py-1 pl-2 pr-1 shadow-xl shadow-ink/10 backdrop-blur-md">
        <button class="kk-seg-btn whitespace-nowrap" title="Skip 2 hours (N)" @click="fireKkEvent('kk-time-skip')">
          <span class="text-ink/80">{{ dateLabel }}</span><span class="text-ink/30">·</span><span class="tabular-nums">{{ formatHour(hour) }}</span>
        </button>
        <span class="kk-seg-div" />
        <button data-tour="mood" class="kk-seg-btn whitespace-nowrap" :class="moodTone" @click="showNeeds = !showNeeds">
          <span aria-hidden="true">{{ sim.mood.emoji }}</span><span class="max-sm:hidden">{{ sim.mood.label }}</span>
        </button>
        <span class="kk-seg-div" />
        <button class="kk-seg-btn whitespace-nowrap" title="Change weather (Y)" @click="fireKkEvent('kk-weather')">
          <span aria-hidden="true">{{ weatherLabel.split(' ')[0] }}</span><span class="max-md:hidden">{{ weatherLabel.split(' ').slice(1).join(' ') }}</span>
        </button>
        <span class="kk-seg-div" />
        <span class="flex items-center gap-1.5 whitespace-nowrap px-2 text-sm font-bold text-leaf" :title="`${online} player${online === 1 ? '' : 's'} online right now`">
          <span class="h-2 w-2 rounded-full bg-leaf" />{{ online.toLocaleString() }}<span class="max-md:hidden">online</span>
        </span>
        <div data-tour="money" class="ml-1 flex items-center gap-1.5 rounded-full bg-paper py-1 pl-3.5 pr-1">
          <span class="whitespace-nowrap font-display text-[15px] font-semibold tabular-nums text-ink" title="Simulated naira (game money, not Bitcoin)">{{ player.ngnDisplay }}</span>
          <button class="flex h-8 w-8 items-center justify-center rounded-full bg-leaf text-lg font-bold text-white hover:bg-kadeep" title="Earn money (jobs)" aria-label="Earn money" @click="ui.open('jobs')">+</button>
        </div>
        <button class="kk-close ml-0.5" title="Settings" aria-label="Settings" @click="emit('settings')">⚙️</button>
      </div>
    </div>

    <!-- top left column: urgent-need goal chip + the story guide (slot) -->
    <div v-if="!work.commute?.active && !work.shift" class="pointer-events-none absolute left-3 top-[4.4rem] z-20 flex flex-col items-start gap-2 sm:left-4">
      <transition enter-active-class="transition duration-300" enter-from-class="-translate-x-4 opacity-0">
        <div v-if="urgentInfo" class="flex items-center gap-3 rounded-full bg-white/85 py-2 pl-2 pr-5 shadow-lg backdrop-blur">
          <span class="flex h-9 w-9 items-center justify-center rounded-full bg-leaf/90 text-lg">{{ urgentInfo.icon }}</span>
          <div class="leading-tight">
            <div class="text-sm font-bold text-ink">{{ urgentInfo.title }}</div>
            <div class="text-xs text-ink/55">{{ urgentInfo.hint }}</div>
          </div>
        </div>
      </transition>
      <slot />
    </div>

    <!-- portrait + needs (bottom left) -->
    <div class="pointer-events-auto absolute bottom-4 left-3 z-20 flex items-end gap-2 sm:left-4 max-lg:[@media(pointer:coarse)]:bottom-auto max-lg:[@media(pointer:coarse)]:top-[4.4rem] max-lg:[@media(pointer:coarse)]:hidden">
      <button class="relative flex h-16 w-16 items-center justify-center rounded-full border-4 bg-gradient-to-br from-[#cfe3d8] to-white font-display text-2xl font-semibold text-kadeep shadow-lg" :class="sim.mood.tone === 'good' ? 'border-leaf' : sim.mood.tone === 'ok' ? 'border-amber-400' : 'border-red-500'" :title="sim.mood.label" @click="showNeeds = !showNeeds">
        {{ initials }}
        <span class="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm shadow">{{ sim.mood.emoji }}</span>
      </button>
      <button data-tour="needs" class="grid grid-cols-3 gap-x-3 gap-y-2 rounded-3xl bg-white/90 px-3.5 py-2.5 shadow-lg backdrop-blur" aria-label="Needs" @click="showNeeds = !showNeeds">
        <div v-for="n in NEEDS" :key="n.key" class="flex items-center gap-1.5" :title="`${n.label}: ${Math.round(sim.needs[n.key])}%`">
          <span class="text-sm leading-none">{{ n.icon }}</span>
          <span class="h-2 w-12 overflow-hidden rounded-full bg-ink/10">
            <span class="block h-full rounded-full transition-all duration-700" :class="barTone(sim.needs[n.key])" :style="{ width: sim.needs[n.key] + '%' }" />
          </span>
        </div>
      </button>
    </div>

    <!-- needs detail card -->
    <div v-if="showNeeds" class="pointer-events-auto absolute bottom-24 left-3 z-30 w-[min(320px,92vw)] kk-panel p-4 sm:left-4">
      <div class="mb-2 flex items-center justify-between">
        <div>
          <div class="font-display text-base font-semibold text-ink">{{ sim.name || 'You' }} is feeling <span :class="moodTone">{{ sim.mood.label.toLowerCase() }}</span></div>
          <div class="text-xs text-ink/50">Keep your needs green to stay happy.</div>
        </div>
        <button class="kk-close" aria-label="Close" @click="showNeeds = false">✕</button>
      </div>
      <div class="space-y-2.5">
        <div v-for="n in NEEDS" :key="n.key">
          <div class="flex items-center justify-between text-xs font-bold text-ink/70">
            <span>{{ n.icon }} {{ n.label }}</span><span class="tabular-nums">{{ Math.round(sim.needs[n.key]) }}%</span>
          </div>
          <div class="mt-1 h-2 overflow-hidden rounded-full bg-ink/10"><div class="h-full rounded-full transition-all" :class="barTone(sim.needs[n.key])" :style="{ width: sim.needs[n.key] + '%' }" /></div>
          <div class="mt-0.5 text-[11px] text-ink/45">{{ n.hint }}</div>
        </div>
      </div>
    </div>

    <!-- activity progress (eating, sleeping...) -->
    <div v-if="sim.activity" class="pointer-events-none absolute inset-x-0 bottom-32 z-20 flex justify-center">
      <div class="kk-panel flex items-center gap-3 px-5 py-3">
        <div class="font-display text-sm font-semibold text-ink">{{ sim.activity.label }}...</div>
        <div class="h-2 w-32 overflow-hidden rounded-full bg-ink/10">
          <div class="h-full rounded-full bg-leaf transition-all" :style="{ width: Math.min(100, (sim.activity.t / sim.activity.dur) * 100) + '%' }" />
        </div>
      </div>
    </div>

    <button class="pointer-events-auto absolute right-3 top-3.5 z-20 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-ink/70 shadow backdrop-blur hover:text-ink max-xl:hidden" title="Hide the HUD" @click="sim.cleanScreen = true">˄ Clean screen</button>
  </template>
</template>
