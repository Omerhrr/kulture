<script setup lang="ts">
// LedgerPanel - auditable transaction history, with real-sats vs k-sats
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
  if (entry.asset_type === 'ksats') {
    const v = entry.amount_minor_units
    return `${v >= 0 ? '+' : ''}${v.toLocaleString('en')} (sim ks)`
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
      <div class="font-display text-base font-semibold text-ink">📜 Ledger</div>
      <button class="kk-close" aria-label="Close" @click="ui.open('ledger')">✕</button>
    </div>

    <div v-if="player.transactions.length === 0" class="py-6 text-center text-sm text-ink/50">No entries yet.</div>
    <div v-for="e in player.transactions" :key="e.id" class="mb-2 rounded-2xl border border-ink/10 bg-paper p-2.5">
      <div class="flex items-center justify-between gap-2">
        <span
          class="text-xs font-extrabold"
          :class="e.asset_type === 'sats_ref' ? 'text-golddark' : e.asset_type === 'reputation' ? 'text-sky-600' : 'text-leaf'"
        >{{ fmt(e) }}</span>
        <span class="kk-chip">{{ e.entry_type.replace(/_/g, ' ') }}</span>
      </div>
      <div class="mt-1 text-[11px] text-ink/55">{{ e.description }}</div>
      <div class="text-[10px] text-ink/35">{{ new Date(e.created_at).toLocaleString() }}</div>
    </div>

    <p class="mt-3 text-[11px] leading-relaxed text-ink/45">
      Real sats entries reference verified Lightning settlements. k-sats are game money only -
      the two are never converted.
    </p>
  </div>
</template>
