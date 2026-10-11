<script setup lang="ts">
// LedgerPanel — auditable transaction history, with real-sats vs sim-NGN
// clearly separated (spec acceptance KK-012).
const player = usePlayerStore()
const ui = useUiStore()

onMounted(() => {
  useGameApi()
    .transactions()
    .then((t) => (player.transactions = t))
    .catch(() => {})
})

function fmt(entry: any) {
  if (entry.asset_type === 'ngn_minor') {
    const v = entry.amount_minor_units / 100
    return `${v >= 0 ? '+' : ''}₦${v.toLocaleString('en-NG')} (sim)`
  }
  if (entry.asset_type === 'sats_ref') {
    return `${entry.amount_minor_units} sats (verified Lightning)`
  }
  if (entry.asset_type === 'reputation') return `+${entry.amount_minor_units} rep`
  return `${entry.amount_minor_units}`
}
</script>

<template>
  <div class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(420px,92vw)] kk-panel kk-scroll max-h-[76vh] overflow-y-auto p-4 sm:right-4">
    <div class="mb-3 flex items-center justify-between">
      <div class="text-base font-bold text-kasand">📜 Ledger</div>
      <button class="kk-btn-ghost !px-2 !py-1" @click="ui.open('ledger')">✕</button>
    </div>

    <div v-if="player.transactions.length === 0" class="py-6 text-center text-sm text-white/50">No entries yet.</div>
    <div v-for="e in player.transactions" :key="e.id" class="mb-2 rounded-lg border border-white/10 bg-white/5 p-2.5">
      <div class="flex items-center justify-between gap-2">
        <span
          class="text-xs font-bold"
          :class="e.asset_type === 'sats_ref' ? 'text-amber-300' : e.asset_type === 'reputation' ? 'text-sky-300' : 'text-emerald-300'"
        >{{ fmt(e) }}</span>
        <span class="kk-chip text-white/40">{{ e.entry_type.replace(/_/g, ' ') }}</span>
      </div>
      <div class="mt-1 text-[11px] text-white/50">{{ e.description }}</div>
      <div class="text-[10px] text-white/30">{{ new Date(e.created_at).toLocaleString() }}</div>
    </div>

    <p class="mt-3 text-[11px] leading-relaxed text-white/40">
      Real sats entries reference verified Lightning settlements. Simulated NGN is game money only —
      the two are never converted.
    </p>
  </div>
</template>
