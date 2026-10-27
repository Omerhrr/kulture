<script setup lang="ts">
// LightningPaymentDialog - BOLT11 invoice, QR, expiry countdown, and the
// verified-settlement flow. Status changes arrive via WebSocket (server-
// authoritative); the client can never mark a payment settled.

import QRCode from 'qrcode'

const payments = usePaymentsStore()
const player = usePlayerStore()
onMounted(() => payments.node || payments.loadNode())
const NET: Record<string, string> = { testnet: 'Bitcoin testnet', signet: 'Bitcoin signet', regtest: 'Regtest' }
const netLabel = computed(() => NET[payments.node?.network ?? ''] ?? 'Testnet')
const demo = computed(() => payments.node?.provider === 'mock')
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
  // tolerate a server timestamp without a zone: it is UTC
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(exp) ? exp : exp + 'Z'
  const ms = new Date(iso).getTime() - now.value
  if (ms <= 0) return 'expired'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

// the four beats of a verified Lightning purchase, shown as a stepper
const STEPS = ['Invoice', 'Pay', 'Verified', 'Delivered']
const stepIdx = computed(() => {
  const st = payments.current?.status ?? ''
  if (st === 'fulfilled') return 4
  if (st === 'settled') return 3
  if (payments.settling) return 2
  if (st === 'awaiting_payment') return 1
  return 0
})
const done = computed(() => stepIdx.value >= 3)
const showWhy = ref(false)

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
    @keydown.esc="done ? payments.close() : payments.cancelCurrent()"
  >
    <div class="kk-panel max-h-[94dvh] w-[min(440px,96vw)] overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="ln-title">
      <!-- header -->
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-[10px] font-extrabold uppercase tracking-[0.14em] text-golddark">⚡ Lightning · {{ netLabel }}</div>
          <div id="ln-title" class="font-display text-lg font-semibold leading-tight text-ink">
            {{ payments.current?.item_name || 'Invoice' }}
            <span v-if="payments.current && payments.current.quantity > 1" class="text-ink/50">×{{ payments.current.quantity }}</span>
          </div>
        </div>
        <button class="kk-close" aria-label="Close" @click="done ? payments.close() : payments.cancelCurrent()">✕</button>
      </div>

      <!-- stepper -->
      <ol class="mt-4 flex items-center gap-1.5" aria-label="Payment progress">
        <li v-for="(st, i) in STEPS" :key="st" class="flex flex-1 flex-col gap-1">
          <div class="h-1.5 rounded-full transition-colors duration-500" :class="i < stepIdx ? 'bg-leaf' : i === stepIdx ? 'bg-kasand' : 'bg-ink/10'" />
          <span class="text-[10px] font-bold" :class="i <= stepIdx ? 'text-ink/70' : 'text-ink/30'">{{ st }}</span>
        </li>
      </ol>

      <!-- invoice view -->
      <template v-if="payments.current?.invoice_bolt11 && !done">
        <div class="mt-4 text-center">
          <div class="font-display text-4xl font-semibold tracking-tight text-ink">
            {{ payments.current.amount_sats.toLocaleString() }}<span class="ml-1.5 text-lg text-ink/45">sats</span>
          </div>
          <div class="mt-1 text-xs font-semibold" :class="expiryLeft === 'expired' ? 'text-red-600' : 'text-ink/45'">
            {{ expiryLeft === 'expired' ? 'Invoice expired - close and try again' : `Expires in ${expiryLeft}` }}
          </div>
        </div>
        <div class="mt-3 flex flex-col items-center gap-3">
          <a :href="`lightning:${payments.current.invoice_bolt11}`" class="rounded-3xl border border-ink/10 bg-white p-2.5 shadow-md" title="Open in your Lightning wallet">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="Lightning invoice QR code - scan with your wallet" class="h-48 w-48 [@media(max-height:500px)]:h-32 [@media(max-height:500px)]:w-32" />
          </a>
          <div class="flex w-full gap-2">
            <a :href="`lightning:${payments.current.invoice_bolt11}`" class="kk-btn-ghost flex-1 text-xs">Open wallet</a>
            <button class="kk-btn-ghost flex-1 text-xs" @click="copyInvoice">Copy invoice</button>
          </div>

          <!-- the test simulator only: stands in for an external wallet -->
          <template v-if="demo">
            <button
              class="kk-btn-primary w-full"
              :disabled="payments.settling || payments.current.status !== 'awaiting_payment'"
              @click="payments.simulateWalletPayment()"
            >
              {{ payments.settling ? 'Waiting for the node to confirm...' : 'Pay with demo wallet' }}
            </button>
            <span class="kk-chip">Test simulator · no real funds move</span>
          </template>
          <template v-else>
            <div class="flex w-full items-center justify-center gap-2 rounded-2xl bg-paper px-3 py-2.5 text-xs font-semibold text-ink/70">
              <span class="h-2 w-2 animate-pulse rounded-full bg-golddark" />
              Waiting for your payment - the node confirms it here.
            </div>
            <span class="kk-chip text-center">Pay from a Lightning wallet on {{ netLabel }} · test sats have no value</span>
          </template>
        </div>
      </template>

      <!-- settled view -->
      <template v-else-if="done">
        <div class="mt-5 flex flex-col items-center gap-2 py-3 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-leaf/10 text-3xl text-leaf">✓</div>
          <div class="font-display text-xl font-semibold text-ink">Paid. It's in your bag.</div>
          <div class="text-sm text-ink/60">
            {{ payments.current?.amount_sats?.toLocaleString() }} sats settled and verified on the Lightning node, then delivered exactly once.
          </div>
          <button class="kk-btn-primary mt-3 w-full" @click="payments.close()">Done</button>
        </div>
      </template>

      <p v-if="payments.error" class="mt-3 rounded-2xl bg-red-50 p-2.5 text-xs font-semibold text-red-600" role="alert">{{ payments.error }}</p>

      <!-- trust model, one tap away instead of two paragraphs up front -->
      <button class="mt-4 w-full border-t border-ink/10 pt-3 text-left text-[11px] font-bold text-ink/50 hover:text-ink" :aria-expanded="showWhy" @click="showWhy = !showWhy">
        {{ showWhy ? '▾' : '▸' }} How is this payment verified?
      </button>
      <p v-if="showWhy" class="mt-1.5 text-[11px] leading-relaxed text-ink/55">
        The server fixes the price when the invoice is created. Your browser can never mark a payment as paid: the backend checks
        settlement with the Lightning node, then fulfils the order once (idempotent). In production you scan the QR with
        Phoenix, Zeus or BlueWallet instead of the demo wallet button.
      </p>
    </div>
  </div>
</template>
