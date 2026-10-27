<script setup lang="ts">
// WhotCard - a Naija Whot card face: the shape drawn big in the middle and
// the number in two corners. "whot" (20) is the wild card.
const props = defineProps<{ shape: string; num: string; big?: boolean; glow?: boolean }>()
const RED = '#7a1f2b'
</script>

<template>
  <div class="relative flex flex-col items-center justify-center rounded-xl border bg-white shadow-md" :class="[big ? 'h-24 w-16' : 'h-[4.5rem] w-12', glow ? 'border-amber-300 ring-2 ring-amber-300' : 'border-ink/10']">
    <span v-if="props.num" class="absolute left-1 top-0.5 text-[10px] font-bold" :style="{ color: RED }">{{ props.num }}</span>
    <span v-if="props.num" class="absolute bottom-0.5 right-1 rotate-180 text-[10px] font-bold" :style="{ color: RED }">{{ props.num }}</span>
    <svg viewBox="0 0 24 24" :class="big ? 'h-9 w-9' : 'h-6 w-6'">
      <circle v-if="props.shape === 'circle'" cx="12" cy="12" r="9" :fill="RED" />
      <polygon v-else-if="props.shape === 'triangle'" points="12,3 22,20 2,20" :fill="RED" />
      <path v-else-if="props.shape === 'cross'" d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" :fill="RED" />
      <rect v-else-if="props.shape === 'square'" x="4" y="4" width="16" height="16" :fill="RED" />
      <polygon v-else-if="props.shape === 'star'" points="12,2 14.6,8.6 21.6,9 16.2,13.5 18,20.4 12,16.6 6,20.4 7.8,13.5 2.4,9 9.4,8.6" :fill="RED" />
      <text v-else x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="800" fill="#111">WHOT</text>
    </svg>
  </div>
</template>
