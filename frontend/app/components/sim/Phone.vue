<script setup lang="ts">
// Phone - an in-game smartphone. Apps open the existing panels so there is
// one place to find everything (jobs, bag, wallet, map, settings, help).
import { useClock, formatHour } from '~/composables/useTimeOfDay'
import { useMapOpen, fireKkEvent } from '~/composables/useControlsState'
import { getQuality, setQuality } from '~/utils/quality'
import { useSimStore } from '~/stores/sim'

const open = useState<boolean>('kk_phone_open', () => false)
const askOpen = useState<boolean>('kk_ask_open', () => false)
const ui = useUiStore()
const sim = useSimStore()
const mapOpen = useMapOpen()
const hour = useClock()
const quality = ref<'high' | 'low'>('high')
onMounted(() => (quality.value = getQuality()))
const page = ref<'home' | 'settings'>('home')
const night = computed(() => hour.value < 6 || hour.value >= 19)

function go(fn: () => void) {
  open.value = false
  fn()
}
const apps = [
  { id: 'jobs', icon: '💼', label: 'Jobs', bg: 'from-emerald-400 to-emerald-600', run: () => go(() => ui.open('jobs')) },
  { id: 'bag', icon: '🎒', label: 'Bag', bg: 'from-amber-300 to-orange-500', run: () => go(() => ui.open('inventory')) },
  { id: 'wallet', icon: '⚡', label: 'Wallet', bg: 'from-yellow-300 to-amber-500', run: () => go(() => ui.open('ledger')) },
  { id: 'map', icon: '🗺️', label: 'Maps', bg: 'from-sky-400 to-blue-600', run: () => go(() => (mapOpen.value = true)) },
  { id: 'weather', icon: '⛅', label: 'Weather', bg: 'from-cyan-300 to-sky-500', run: () => fireKkEvent('kk-weather') },
  { id: 'ask', icon: '✨', label: 'Ask', bg: 'from-fuchsia-400 to-violet-600', run: () => go(() => (askOpen.value = true)) },
  { id: 'me', icon: '🙂', label: 'Me', bg: 'from-rose-300 to-pink-500', run: () => go(() => document.querySelector<HTMLElement>('[data-tour=needs]')?.click()) },
  { id: 'settings', icon: '⚙️', label: 'Settings', bg: 'from-slate-400 to-slate-600', run: () => (page.value = 'settings') }
]
watch(open, (o) => o && (page.value = 'home'))
</script>

<template>
  <transition enter-active-class="transition duration-300 ease-out" enter-from-class="translate-y-full opacity-0" leave-active-class="transition duration-200" leave-to-class="translate-y-full opacity-0">
    <div v-if="open" class="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/30 p-3 backdrop-blur-[2px] sm:items-center" @click.self="open = false">
      <div class="relative">
        <button class="absolute -top-12 right-0 rounded-full bg-white px-4 py-2 text-sm font-bold text-ink shadow-lg" @click="open = false">✕ Close</button>
        <!-- device -->
        <div class="h-[min(640px,82dvh)] w-[min(320px,88vw)] rounded-[2.8rem] bg-[#111] p-2.5 shadow-2xl">
          <div class="relative flex h-full flex-col overflow-hidden rounded-[2.3rem] bg-gradient-to-b text-white" :class="night ? 'from-[#1e1b4b] via-[#4c1d95] to-[#9d174d]' : 'from-[#5b4bff] via-[#a855f7] to-[#fb923c]'">
            <div class="flex items-center justify-between px-6 pt-3 text-xs font-bold">
              <span class="tabular-nums">{{ formatHour(hour) }}</span>
              <span class="h-6 w-24 rounded-full bg-black" />
              <span>●●● 4G</span>
            </div>
            <template v-if="page === 'home'">
              <div class="px-6 pt-6">
                <div class="font-display text-6xl font-semibold tabular-nums leading-none">{{ formatHour(hour).replace(/\s?[AP]M/i, '') }}</div>
                <div class="mt-1 text-sm font-semibold text-white/80">{{ sim.name ? '@' + sim.name : 'Kaduna' }} · Kaduna</div>
              </div>
              <div class="mt-auto grid grid-cols-4 gap-x-3 gap-y-4 px-5 pb-8">
                <button v-for="a in apps" :key="a.id" class="flex flex-col items-center gap-1.5" @click="a.run()">
                  <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl shadow-lg" :class="a.bg">{{ a.icon }}</span>
                  <span class="text-[11px] font-bold text-white/95">{{ a.label }}</span>
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2 px-5 pt-5">
                <button class="rounded-full bg-white/20 px-3 py-1 text-sm font-bold" @click="page = 'home'">‹ Back</button>
                <div class="font-display text-lg font-semibold">Settings</div>
              </div>
              <div class="m-4 space-y-2 rounded-3xl bg-white/95 p-3 text-ink">
                <div class="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">Sound <AudioSystem /></div>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold hover:bg-ink/5" @click="setQuality(quality === 'low' ? 'high' : 'low')">
                  Graphics <span class="kk-chip">{{ quality === 'low' ? '⚡ Lite' : '✨ HD' }}</span>
                </button>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold hover:bg-ink/5" @click="(sim.tourDone = false), sim.save(), (open = false)">
                  Replay the tour <span>›</span>
                </button>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold text-red-600 hover:bg-red-50" @click="sim.reset(), (open = false)">
                  Create a new Sim <span>›</span>
                </button>
              </div>
            </template>
            <div class="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/70" />
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
