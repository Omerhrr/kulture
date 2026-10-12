<script setup lang="ts">
// CommuteCard - the ride panel while the cab drives you (top left), with
// Skip ride / Turn back and the camera view switcher (right).
import { useWorkStore } from '~/stores/work'
import { fireKkEvent } from '~/composables/useControlsState'

const work = useWorkStore()
const c = computed(() => work.commute)
const eta = computed(() => {
  const s = Math.round(c.value?.eta ?? 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
const VIEWS = [
  { id: 'chase', icon: '🎥', label: 'Chase' },
  { id: 'side', icon: '👀', label: 'Side' },
  { id: 'top', icon: '🛰️', label: 'Top' }
] as const
</script>

<template>
  <template v-if="c?.active">
    <div class="pointer-events-auto absolute left-3 top-[4.4rem] z-30 w-[min(340px,86vw)] rounded-3xl bg-ink/70 p-4 text-white shadow-2xl backdrop-blur-md sm:left-4">
      <div class="font-display text-[15px] font-semibold leading-snug">
        {{ c.vehicle }} · {{ c.returning ? 'Turning back' : `To ${c.name}` }}
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
        <div class="h-full rounded-full bg-kasand transition-[width] duration-500" :style="{ width: c.progress * 100 + '%' }" />
      </div>
      <div class="mt-2 flex items-center justify-between text-xs text-white/75">
        <span>{{ eta }} to go</span>
        <span class="rounded-full bg-leaf/90 px-2 py-0.5 font-bold text-white">Moving</span>
      </div>
      <div class="mt-2.5 rounded-xl bg-white/10 px-3 py-2 text-sm">{{ c.msg }}</div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button class="rounded-full bg-white py-2.5 text-sm font-bold text-ink hover:bg-white/90 disabled:opacity-40" :disabled="!c.code && !c.returning" :title="c.code ? '' : 'Skip works for named places'" @click="fireKkEvent('kk-commute-skip')">Skip ride ›</button>
        <button class="rounded-full bg-white/15 py-2.5 text-sm font-bold text-white hover:bg-white/25 disabled:opacity-40" :disabled="c.returning" @click="fireKkEvent('kk-commute-back')">↩ Turn back</button>
      </div>
    </div>
    <div class="pointer-events-auto absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-1 rounded-3xl bg-white/85 p-1.5 shadow-xl backdrop-blur sm:right-4">
      <button v-for="v in VIEWS" :key="v.id" class="flex w-16 flex-col items-center rounded-2xl py-2 text-[11px] font-bold" :class="c.view === v.id ? 'bg-ink text-white' : 'text-ink/60 hover:bg-ink/5'" @click="c.view = v.id">
        <span class="text-lg">{{ v.icon }}</span>{{ v.label }}
      </button>
    </div>
  </template>
</template>
