<script setup lang="ts">
// InteractionPrompt - nearest interactable + action menu (options are
// server-validated on interaction; the client never decides what is possible).
// Also surfaces the ride and door prompts (board a keke, enter a house).

import { fireKkEvent } from '~/composables/useControlsState'

const proximity = useState<{ entityId: string; name: string; code: string } | null>(
  'kk_proximity',
  () => null
)
const ride = useRide()
const doorPrompt = useDoorPrompt()
const ui = useUiStore()
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center">
    <transition
      enter-active-class="transition duration-200"
      enter-from-class="translate-y-4 opacity-0"
      leave-active-class="transition duration-200"
      leave-to-class="translate-y-4 opacity-0"
    >
      <!-- board / exit a vehicle -->
      <div v-if="ride.active" class="kk-panel px-5 py-3 text-center">
        <div class="text-[11px] font-bold uppercase tracking-widest text-ink/40">{{ ride.name }}</div>
        <div class="font-display text-base font-semibold text-ink">{{ ride.speed }} km/h</div>
        <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button class="kk-btn-primary" @click="fireKkEvent('kk-ride-view')">
            {{ ride.inner ? 'Outer view' : 'Inner view' }}
            <span class="ml-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px]">V</span>
          </button>
          <button class="kk-btn-ghost" @click="fireKkEvent('kk-ride-toggle')">
            Exit <span class="ml-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px]">E</span>
          </button>
        </div>
      </div>
      <div v-else-if="ride.prompt && !ui.anyBlocking" class="kk-panel px-5 py-3.5 text-center">
        <div class="font-display text-base font-semibold text-ink">{{ ride.prompt }}</div>
        <button class="kk-btn-primary mt-2" @click="fireKkEvent('kk-ride-toggle')">
          Board <span class="ml-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px]">E</span>
        </button>
      </div>
      <!-- enter / exit a house -->
      <div v-else-if="doorPrompt && !ui.anyBlocking" class="kk-panel px-5 py-3.5 text-center">
        <div class="font-display text-base font-semibold text-ink">{{ doorPrompt.label }}</div>
        <button class="kk-btn-primary mt-2" @click="fireKkEvent('kk-door-use')">
          {{ doorPrompt.action === 'enter' ? 'Walk in' : 'Step out' }}
          <span class="ml-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px]">E</span>
        </button>
      </div>
      <div v-else-if="proximity && !ui.anyBlocking" class="kk-panel pointer-events-auto px-5 py-3.5 text-center">
        <div class="text-[11px] font-bold uppercase tracking-widest text-ink/40">{{ proximity.code.replace(/_/g, ' ') }}</div>
        <div class="font-display text-base font-semibold text-ink">{{ proximity.name }}</div>
        <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button class="kk-btn-primary" @click="ui.interactWith(proximity)">
            Talk / Interact <span class="ml-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px]">E</span>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
