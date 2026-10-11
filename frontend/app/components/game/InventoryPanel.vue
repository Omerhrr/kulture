<script setup lang="ts">
// InventoryPanel — server-owned items.
const player = usePlayerStore()
const ui = useUiStore()
</script>

<template>
  <div class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(360px,92vw)] kk-panel kk-scroll max-h-[70vh] overflow-y-auto p-4 sm:right-4">
    <div class="mb-3 flex items-center justify-between">
      <div class="text-base font-bold text-kasand">🎒 Inventory</div>
      <button class="kk-btn-ghost !px-2 !py-1" @click="ui.open('inventory')">✕</button>
    </div>

    <div v-if="player.inventory.length === 0" class="py-6 text-center text-sm text-white/50">
      Empty. Buy something from Musa or run a delivery job.
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="i in player.inventory"
        :key="i.code"
        class="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2.5"
      >
        <div class="text-xl">{{ i.emoji }}</div>
        <div class="flex-1 text-sm font-semibold">{{ i.name }}</div>
        <span class="kk-chip text-kasand">×{{ i.quantity }}</span>
      </div>
    </div>

    <div v-if="player.hasParcel" class="mt-3 rounded-lg bg-emerald-400/10 p-2 text-[11px] text-emerald-200">
      📦 You carry a sealed package — deliver it to Stonetech Square (Jobs panel).
    </div>
  </div>
</template>
