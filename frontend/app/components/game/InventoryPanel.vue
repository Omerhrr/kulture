<script setup lang="ts">
// InventoryPanel - server-owned items.
const player = usePlayerStore()
const ui = useUiStore()
</script>

<template>
  <div class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(360px,92vw)] kk-panel kk-scroll max-h-[70vh] overflow-y-auto p-4 sm:right-4">
    <div class="mb-3 flex items-center justify-between">
      <div class="font-display text-base font-semibold text-ink">🎒 Inventory</div>
      <button class="kk-close" aria-label="Close" @click="ui.open('inventory')">✕</button>
    </div>

    <div v-if="player.inventory.length === 0" class="py-6 text-center text-sm text-ink/50">
      Empty. Buy something from Musa or run a delivery job.
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="i in player.inventory"
        :key="i.code"
        class="flex items-center gap-3 rounded-2xl border border-ink/10 bg-paper p-2.5"
      >
        <div class="text-xl">{{ i.emoji }}</div>
        <div class="flex-1 text-sm font-extrabold text-ink">{{ i.name }}</div>
        <span class="kk-chip border-golddark/25 bg-kasand/15 text-golddark">×{{ i.quantity }}</span>
      </div>
    </div>

    <div v-if="player.hasParcel" class="mt-3 rounded-2xl bg-leaf/10 p-2.5 text-[11px] font-semibold text-leaf">
      📦 You carry a sealed package - deliver it to Stonetech Square (Jobs panel).
    </div>
  </div>
</template>
