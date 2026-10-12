// Billboard adverts: what is on air on each board (server truth), the ad
// editor state, and buying a slot through the normal Lightning dialog.
import { defineStore } from 'pinia'

export interface LiveAd {
  id: string
  board_id: string
  brand: string
  headline: string
  subline: string
  cta: string
  url: string
  domain: string
  theme: string
  ends_at: string | null
}

export const useAdsStore = defineStore('ads', {
  state: () => ({
    boards: {} as Record<string, LiveAd[]>,
    price: 1000,
    maxDays: 7,
    autoApprove: false,
    version: 0,
    sheetBoard: null as string | null,
    mine: [] as any[],
    pendingAdId: null as string | null
  }),
  actions: {
    async refresh() {
      const r = await useGameApi().adBoards()
      this.boards = r.boards
      this.price = r.price_sats_per_day
      this.maxDays = r.max_days
      this.autoApprove = r.auto_approve
      this.version++
    },
    async loadMine() {
      this.mine = await useGameApi().myAds()
    },
    /** create the ad + invoice, then hand over to the Lightning dialog */
    async buy(ad: Record<string, unknown>) {
      const payments = usePaymentsStore()
      const r = await useGameApi().createAd(ad)
      this.pendingAdId = r.ad.id
      payments.error = ''
      payments.current = r.intent
      payments.dialogOpen = true
      return r
    },
    open(boardId: string) {
      this.sheetBoard = boardId
      this.refresh().catch(() => {})
      this.loadMine().catch(() => {})
    }
  }
})
