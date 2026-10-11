<script setup lang="ts">
// Top HUD: identity, balances (clearly separated asset classes per spec),
// connection state, the day/night clock and the world event banner.

import { useClock, formatHour } from '~/composables/useTimeOfDay'
import { fireKkEvent } from '~/composables/useControlsState'

const player = usePlayerStore()
const wsStatus = useState<'connecting' | 'open' | 'closed'>('kk_ws_status', () => 'closed')
const world = useWorldStore()
const mapOpen = useMapOpen()
const hour = useClock()

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
    <div class="pointer-events-auto kk-panel flex items-center gap-3 px-4 py-2.5">
      <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-kadeep text-lg">🛺</div>
      <div>
        <div class="text-sm font-extrabold leading-tight text-ink">
          {{ player.profile?.display_name || 'Player' }}
          <span class="ml-1 kk-chip border-golddark/25 bg-kasand/15 text-golddark">REP {{ player.profile?.reputation ?? 0 }}</span>
        </div>
        <div class="mt-0.5 flex items-center gap-2 text-xs">
          <span class="kk-chip" title="Simulated in-game currency - NOT Bitcoin">💰 {{ player.ngnDisplay }} <span class="text-ink/40">NGN (sim)</span></span>
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

    <!-- right: clock + panels + help -->
    <div class="pointer-events-auto flex items-center gap-2">
      <button
        class="kk-btn-ghost !px-3 font-mono text-sm"
        title="Tap to skip 2 hours (N)"
        @click="fireKkEvent('kk-time-skip')"
      >
        {{ phaseIcon }} {{ formatHour(hour) }}
      </button>
      <AudioSystem />
      <button class="kk-btn-ghost !px-3.5" title="City map (M)" @click="mapOpen = true">
        🗺 <span class="hidden sm:inline">Map</span>
      </button>
      <button class="kk-btn-ghost !px-3.5" @click="emit('open', 'inventory')" title="Inventory (I)">
        🎒 <span class="hidden sm:inline">Inventory</span>
      </button>
      <button class="kk-btn-ghost !px-3.5" @click="emit('open', 'jobs')" title="Jobs (J)">
        🧾 <span class="hidden sm:inline">Jobs</span>
      </button>
      <button class="kk-btn-ghost !px-3.5" @click="emit('open', 'ledger')" title="Transactions (T)">
        📜 <span class="hidden sm:inline">Ledger</span>
      </button>
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
