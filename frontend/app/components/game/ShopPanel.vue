<script setup lang="ts">
// ShopPanel — server-listed goods with dual pricing (simulated NGN vs real sats).
// Purchases always create a Lightning invoice — the server owns pricing.

const payments = usePaymentsStore()
const ui = useUiStore()

const qty = ref(1)

function fmtNgn(minor: number) {
  return `₦${(minor / 100).toLocaleString('en-NG')}`
}
</script>

<template>
  <div class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(420px,92vw)] kk-panel kk-scroll max-h-[76vh] overflow-y-auto p-4 sm:right-4">
    <div class="mb-3 flex items-center justify-between">
      <div>
        <div class="text-base font-bold text-kasand">{{ payments.business?.name || 'Shop' }}</div>
        <div class="text-[11px] text-white/50">
          Status:
          <span :class="payments.business?.status === 'open' ? 'text-emerald-300' : 'text-amber-300'">
            {{ payments.business?.status?.replace('_', ' ') }}
          </span>
        </div>
      </div>
      <button class="kk-btn-ghost !px-2 !py-1" @click="ui.open('shop')">✕</button>
    </div>

    <div v-if="payments.paying" class="py-8 text-center text-sm text-white/60">Creating invoice…</div>

    <div v-else class="space-y-2">
      <div
        v-for="l in payments.business?.listings || []"
        :key="l.id"
        class="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
      >
        <div class="text-2xl">{{ l.emoji }}</div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold">{{ l.item_name }}</div>
          <div class="truncate text-[11px] text-white/45">{{ l.description }}</div>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span class="kk-chip text-kasand">⚡ {{ l.price_sats.toLocaleString() }} sats</span>
            <span class="kk-chip text-white/60">💰 {{ fmtNgn(l.price_ngn_minor) }} sim</span>
            <span class="kk-chip" :class="l.quantity_available > 0 ? 'text-emerald-300' : 'text-red-300'">
              {{ l.quantity_available > 0 ? `${l.quantity_available} in stock` : 'sold out' }}
            </span>
          </div>
        </div>
        <button
          class="kk-btn-primary !px-3 !py-1.5 text-xs"
          :disabled="l.quantity_available <= 0 || payments.business?.status !== 'open'"
          @click="payments.startPurchase(l.id, qty)"
        >
          Buy ⚡
        </button>
      </div>
    </div>

    <p class="mt-3 rounded-lg bg-amber-400/10 p-2 text-[11px] leading-relaxed text-amber-200/80">
      ⚡ Lightning prices are <b>real Bitcoin (sats)</b> paid from YOUR wallet — settled and verified by
      the backend before delivery. 💰 NGN prices are simulated game money only, never convertible.
    </p>
    <p v-if="payments.error" class="mt-2 rounded bg-red-500/15 p-2 text-xs text-red-200">{{ payments.error }}</p>
  </div>
</template>
