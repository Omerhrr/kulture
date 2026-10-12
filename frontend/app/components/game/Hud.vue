<script setup lang="ts">
import { getQuality, setQuality } from '~/utils/quality'
const quality = ref<'high' | 'low'>('high')
onMounted(() => (quality.value = getQuality()))
// Top HUD: identity, balances (clearly separated asset classes per spec),
// connection state, the day/night clock and the world event banner.

import { useClock, formatHour } from '~/composables/useTimeOfDay'
import { fireKkEvent } from '~/composables/useControlsState'

const player = usePlayerStore()
const wsStatus = useState<'connecting' | 'open' | 'closed'>('kk_ws_status', () => 'closed')
const world = useWorldStore()
const mapOpen = useMapOpen()
const isTouch = useIsTouch()
const settingsOpen = ref(false)
const settingsRoot = ref<HTMLElement>()
function outside(e: PointerEvent) {
  if (settingsOpen.value && settingsRoot.value && !settingsRoot.value.contains(e.target as Node)) settingsOpen.value = false
}
onMounted(() => window.addEventListener('pointerdown', outside))
onBeforeUnmount(() => window.removeEventListener('pointerdown', outside))
const activeJobs = computed(() => player.jobs.some((j) => j.status === 'assigned' || j.status === 'in_progress'))
const hour = useClock()
const weatherLabel = useState<string>('kk_weather_label', () => '☀️ Sunny')

const emit = defineEmits<{
  (e: 'open', panel: 'inventory' | 'jobs' | 'ledger'): void
}>()

const phaseIcon = computed(() => {
  const h = hour.value % 24
  if (h >= 5 && h < 8) return '🌅'
  if (h >= 8 && h < 17) return '☀️'
  if (h >= 17 && h < 19.5) return '🌇'
  return '🌙'
})
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3 sm:p-4">
    <!-- left: identity + balances -->
    <div class="pointer-events-auto kk-panel flex items-center gap-3 px-4 py-2.5 max-sm:px-3 max-sm:py-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-kadeep text-lg max-sm:hidden [@media(max-height:500px)]:hidden">🛺</div>
      <div>
        <div class="text-sm font-extrabold leading-tight text-ink">
          {{ player.profile?.display_name || 'Player' }}
          <span class="ml-1 kk-chip border-golddark/25 bg-kasand/15 text-golddark">REP {{ player.profile?.reputation ?? 0 }}</span>
        </div>
        <div class="mt-0.5 flex items-center gap-2 text-xs">
          <span class="kk-chip" title="Simulated in-game currency - NOT Bitcoin">💰 {{ player.ngnDisplay }} <span class="text-ink/40 max-sm:hidden [@media(max-height:500px)]:hidden">NGN (sim)</span></span>
          <span
            class="kk-chip"
            :class="wsStatus === 'open' ? 'text-leaf' : 'text-amber-600'"
            :title="`WebSocket ${wsStatus}`"
          >
            <span class="inline-block h-1.5 w-1.5 rounded-full"
              :class="wsStatus === 'open' ? 'bg-leaf' : 'bg-amber-500'" />
            {{ wsStatus === 'open' ? 'Live' : wsStatus }}
          </span>
        </div>
      </div>
    </div>

    <!-- right: world state | primary nav | settings -->
    <div class="pointer-events-auto flex flex-wrap items-center justify-end gap-2 max-sm:max-w-[52vw]">
      <!-- world: time + weather share one pill (both are "tap to change") -->
      <div class="kk-seg">
        <button class="kk-seg-btn font-mono" title="Time - tap to skip 2 hours (N)" @click="fireKkEvent('kk-time-skip')">
          <span aria-hidden="true">{{ phaseIcon }}</span>{{ formatHour(hour) }}
        </button>
        <span class="kk-seg-div" />
        <button class="kk-seg-btn" title="Weather - tap to change (Y)" @click="fireKkEvent('kk-weather')">
          <span aria-hidden="true">{{ weatherLabel.split(' ')[0] }}</span>
          <span class="hidden lg:inline">{{ weatherLabel.split(' ').slice(1).join(' ') }}</span>
        </button>
      </div>

      <!-- primary navigation -->
      <nav class="kk-seg" aria-label="Game panels">
        <button v-if="!isTouch" class="kk-seg-btn" title="City map (M)" @click="mapOpen = true">
          <span aria-hidden="true">🗺</span><span class="kk-lbl">Map</span><kbd class="kk-kbd">M</kbd>
        </button>
        <button class="kk-seg-btn" title="Inventory (I)" @click="emit('open', 'inventory')">
          <span aria-hidden="true">🎒</span><span class="kk-lbl">Bag</span><kbd class="kk-kbd">I</kbd>
        </button>
        <button class="kk-seg-btn relative" title="Jobs (J)" @click="emit('open', 'jobs')">
          <span aria-hidden="true">🧾</span><span class="kk-lbl">Jobs</span><kbd class="kk-kbd">J</kbd>
          <span v-if="activeJobs" class="absolute right-1 top-1 h-2 w-2 rounded-full bg-gold ring-2 ring-white" />
        </button>
        <button class="kk-seg-btn" title="Transactions (T)" @click="emit('open', 'ledger')">
          <span aria-hidden="true">📜</span><span class="kk-lbl">Ledger</span><kbd class="kk-kbd">T</kbd>
        </button>
      </nav>

      <!-- settings: sound + graphics quality tucked away -->
      <div ref="settingsRoot" class="relative">
        <button class="kk-seg !px-3 !py-2" :aria-expanded="settingsOpen" title="Settings" @click="settingsOpen = !settingsOpen">⚙️</button>
        <div v-show="settingsOpen" class="kk-panel absolute right-0 top-12 w-56 p-2 text-sm">
          <div class="flex items-center justify-between rounded-2xl px-2 py-1.5">
            <span class="font-semibold">Sound <span class="text-ink/40">(P)</span></span>
            <AudioSystem />
          </div>
          <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 hover:bg-ink/5" @click="setQuality(quality === 'low' ? 'high' : 'low')">
            <span class="font-semibold">Graphics</span>
            <span class="kk-chip">{{ quality === 'low' ? '⚡ Lite' : '✨ HD' }}</span>
          </button>
          <p class="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-ink/50">Lite turns off shadows for smoother play on laptops and phones.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- world event banner -->
  <transition
    enter-active-class="transition duration-300"
    enter-from-class="-translate-y-8 opacity-0"
    leave-active-class="transition duration-500"
    leave-to-class="-translate-y-8 opacity-0"
  >
    <div
      v-if="world.activeBanner"
      class="pointer-events-none absolute inset-x-0 top-20 z-20 flex justify-center"
    >
      <div class="kk-panel border-golddark/30 px-5 py-2 text-sm font-bold text-golddark">
        ⚡ {{ world.activeBanner }}
      </div>
    </div>
  </transition>
</template>
