import { defineStore } from 'pinia'
import type { Business, PaymentIntent } from '~/types'

/** what a node failure means for the player (the server's codes) */
function lnError(m: string): string {
  if (/not_configured|mock_disabled|unknown_provider/.test(m)) return 'Lightning payments are not set up on this server yet (it needs a testnet node). Try again later.'
  if (/unreachable/.test(m)) return 'The Lightning node is not answering right now. Try again in a minute.'
  if (/wrong_network|mainnet|network_mismatch/.test(m)) return 'The server\'s Lightning node is on the wrong network, so payments are paused for safety.'
  return m
}

export const usePaymentsStore = defineStore('payments', {
  state: () => ({
    dialogOpen: false,
    business: null as Business | null,
    current: null as PaymentIntent | null,
    paying: false,
    settling: false,
    error: '',
    /** the Lightning node the server talks to: testnet / signet / regtest */
    node: null as null | { provider: string; network: string; ready: boolean; error?: string }
  }),
  actions: {
    async loadNode() {
      try {
        this.node = await useGameApi().apiGet('/lightning/health')
      } catch {}
    },
    /** while the QR is up, ask the server (which asks the node) every 3 s;
     *  settlement on a real node is only known by asking */
    watchPayment() {
      const id = this.current?.id
      if (!id) return
      const api = useGameApi()
      const tick = async () => {
        if (!this.dialogOpen || this.current?.id !== id || this.current.status !== 'awaiting_payment') return
        try {
          const cur = await api.intent(id)
          if (this.current?.id === id) this.current = cur
          if (cur.status === 'settled') return this.onServerEvent({ type: 'payment.status', payload: { intent_id: id, status: 'settled' } })
        } catch {}
        setTimeout(tick, 3000)
      }
      setTimeout(tick, 3000)
    },
    async openForBusiness(businessId: string) {
      const api = useGameApi()
      this.business = await api.business(businessId)
      this.current = null
      this.error = ''
    },
    async startPurchase(listingId: string, quantity: number) {
      const api = useGameApi()
      this.error = ''
      this.paying = true
      this.dialogOpen = true
      try {
        const idem = `web-${localStorage.getItem('kk_player_id') || 'anon'}-${listingId.slice(0, 8)}-${Date.now()}`
        const intent = await api.purchase(listingId, quantity, idem)
        this.current = await api.createInvoice(intent.id)
        this.watchPayment()
      } catch (e: any) {
        this.error = lnError(e.message || 'Could not create invoice')
      } finally {
        this.paying = false
      }
    },
    async startDeposit(sats: number) {
      const api = useGameApi()
      this.error = ''
      this.paying = true
      this.dialogOpen = true
      try {
        const { intent } = await api.deposit(sats)
        this.current = await api.createInvoice(intent.id)
        this.watchPayment()
      } catch (e: any) {
        this.error = lnError(e.message || 'Could not create deposit invoice')
      } finally {
        this.paying = false
      }
    },
    async simulateWalletPayment() {
      if (!this.current?.invoice_bolt11) return
      const api = useGameApi()
      this.settling = true
      this.error = ''
      try {
        await api.simulateWalletPayment(this.current.invoice_bolt11)
        // settlement confirmation arrives via WebSocket; poll once as backup
        await new Promise((r) => setTimeout(r, 900))
        this.current = await api.intent(this.current.id)
      } catch (e: any) {
        this.error = e.message || 'Simulation failed'
      } finally {
        this.settling = false
      }
    },
    /** close without cancelling (used after a verified settlement) */
    close() {
      this.dialogOpen = false
      this.current = null
    },
    async cancelCurrent() {
      if (!this.current) return
      const api = useGameApi()
      try {
        this.current = await api.cancelIntent(this.current.id)
      } catch {
        /* ignore */
      }
      this.dialogOpen = false
      this.current = null
    },
    onServerEvent(e: any) {
      if (e.type === 'payment.status' && this.current && e.payload?.intent_id === this.current.id) {
        this.current = { ...this.current, status: e.payload.status }
        if (e.payload.status === 'settled') {
          setTimeout(() => {
            this.dialogOpen = false
            this.current = null
          }, 4500)
        }
      }
    }
  }
})
