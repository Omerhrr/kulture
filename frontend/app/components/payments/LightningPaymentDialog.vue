<script setup lang="ts">
// LightningPaymentDialog - BOLT11 invoice, QR, expiry countdown, and the
// verified-settlement flow. Status changes arrive via WebSocket (server-
// authoritative); the client can never mark a payment settled.

import QRCode from 'qrcode'

const payments = usePaymentsStore()
const player = usePlayerStore()
const ui = useUiStore()

const qrDataUrl = ref('')
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

watch(
  () => payments.current?.invoice_bolt11,
  async (bolt11) => {
    if (bolt11) {
      qrDataUrl.value = await QRCode.toDataURL(bolt11.toUpperCase(), {
        width: 320,
        margin: 1,
        color: { dark: '#1c2b25', light: '#ffffff' },
        errorCorrectionLevel: 'L'
      })
    } else {
      qrDataUrl.value = ''
    }
  },
  { immediate: true }
)

watch(
  () => payments.dialogOpen,
  (open) => {
    if (open && !timer) {
      timer = setInterval(() => (now.value = Date.now()), 1000)
    } else if (!open && timer) {
      clearInterval(timer)
      timer = null
    }
  }
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const expiryLeft = computed(() => {
  const exp = payments.current?.invoice_expires_at
  if (!exp) return ''
  const ms = new Date(exp).getTime() - now.value
  if (ms <= 0) return 'expired'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

function copyInvoice() {
  if (payments.current?.invoice_bolt11) {
    navigator.clipboard?.writeText(payments.current.invoice_bolt11)
    ui.showToast('Invoice copied', 'success')
  }
}
</script>

<template>
  <div
    v-if="payments.dialogOpen"
    class="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-ink/50 p-3 backdrop-blur-sm"
  >
    <div class="kk-panel w-[min(480px,96vw)] p-5">
      <div class="flex items-start justify-between">
        <div>
          <div class="text-xs font-bold uppercase tracking-widest text-ink/40">Lightning Payment</div>
          <div class="font-display text-lg font-semibold text-ink">
            {{ payments.current?.item_name || 'Invoice' }}
            <span v-if="payments.current && payments.current.quantity > 1">×{{ payments.current.quantity }}</span>
          </div>
        </div>
        <button class="kk-btn-ghost !px-2 !py-1" @click="payments.cancelCurrent()">✕</button>
      </div>

      <!-- invoice view -->
      <template v-if="payments.current?.invoice_bolt11 && payments.current.status !== 'settled'">
        <div class="mt-4 flex flex-col items-center gap-3">
          <div class="rounded-3xl border border-ink/10 bg-white p-2.5 shadow-md">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="BOLT11 invoice QR code" class="h-56 w-56" />
          </div>
          <div class="flex flex-wrap items-center justify-center gap-2">
            <span class="kk-chip border-golddark/25 bg-kasand/15 text-golddark">⚡ {{ payments.current.amount_sats.toLocaleString() }} sats</span>
            <span class="kk-chip">⏳ {{ expiryLeft }}</span>
            <span class="kk-chip" :class="payments.current.status === 'awaiting_payment' ? 'text-sky-600' : 'text-ink/55'">
              {{ payments.current.status.replace('_', ' ') }}
            </span>
          </div>
          <button class="kk-btn-ghost text-xs" @click="copyInvoice">📋 Copy invoice (BOLT11)</button>

          <!-- dev-only wallet simulator (stands in for an external wallet) -->
          <button
            class="kk-btn-primary w-full"
            :disabled="payments.settling || payments.current.status !== 'awaiting_payment'"
            @click="payments.simulateWalletPayment()"
          >
            {{ payments.settling ? 'Paying from wallet...' : '🪙 Simulate external wallet payment (dev)' }}
          </button>
          <p class="text-center text-[11px] leading-relaxed text-ink/45">
            In production this button disappears: scan the QR with Phoenix/Zeus/BlueWallet and the
            backend verifies settlement against the Lightning node before delivering the item.
          </p>
        </div>
      </template>

      <!-- settled view -->
      <template v-else-if="payments.current?.status === 'settled'">
        <div class="mt-6 flex flex-col items-center gap-2 py-6 text-center">
          <div class="text-5xl">✅</div>
          <div class="font-display text-lg font-semibold text-leaf">Settlement verified!</div>
          <div class="text-sm text-ink/60">
            Item delivered to your inventory - exactly once, after the backend confirmed the
            Lightning payment.
          </div>
        </div>
      </template>

      <p v-if="payments.error" class="mt-3 rounded-2xl bg-red-50 p-2 text-xs font-semibold text-red-600">{{ payments.error }}</p>

      <div class="mt-4 border-t border-ink/10 pt-3 text-[11px] leading-relaxed text-ink/45">
        Amount is fixed by the server at purchase time. A browser message is never proof of payment -
        settlement is verified against the Lightning node (idempotent, exactly-once fulfillment).
      </div>
    </div>
  </div>
</template>
