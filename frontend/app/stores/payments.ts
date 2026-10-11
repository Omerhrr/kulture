import { defineStore } from 'pinia'
import type { Business, PaymentIntent } from '~/types'

export const usePaymentsStore = defineStore('payments', {
  state: () => ({
    dialogOpen: false,
    business: null as Business | null,
    current: null as PaymentIntent | null,
    paying: false,
    settling: false,
    error: ''
  }),
  actions: {
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
      } catch (e: any) {
        this.error = e.message || 'Could not create invoice'
        this.dialogOpen = false
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
          }, 1600)
        }
      }
    }
  }
})
