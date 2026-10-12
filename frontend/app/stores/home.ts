// Your home's furniture (server-owned) + build mode state.
import { defineStore } from 'pinia'
import type { Placed } from '~/utils/furniture'

export interface CatalogItem {
  sku: string
  name: string
  price_ngn_minor: number
  sell_ngn_minor: number
  category: string
}

export const useHomeStore = defineStore('home', {
  state: () => ({
    items: [] as Placed[],
    catalog: [] as CatalogItem[],
    balance: 0,
    loaded: false,
    build: false,
    selected: null as string | null,
    busy: false,
    version: 0
  }),
  getters: {
    selectedItem(s): Placed | undefined {
      return s.items.find((i) => i.uid === s.selected)
    }
  },
  actions: {
    apply(r: { items: any[]; catalog: any[]; balance_ngn_minor: number }) {
      this.items = r.items
      this.catalog = r.catalog
      this.balance = r.balance_ngn_minor
      this.loaded = true
      this.version++
    },
    async load(starter: () => Array<{ sku: string; x: number; z: number; rot: number }>) {
      const api = useGameApi()
      const r = await api.home()
      if (r.items.length) return this.apply(r)
      this.apply(await api.homeInit(starter()))
    },
    async move(uid: string, x: number, z: number, rot: number) {
      const it = this.items.find((i) => i.uid === uid)
      if (it) Object.assign(it, { x, z, rot })
      this.version++
      await useGameApi().homeMove(uid, x, z, rot)
    },
    async buy(sku: string, x: number, z: number) {
      this.busy = true
      try {
        const r = await useGameApi().homeBuy(sku, x, z)
        this.apply(r)
        this.selected = r.item.uid
        useState<any>('kk_socket_send').value?.('state.resync', {})
        return r.item
      } finally {
        this.busy = false
      }
    },
    async sell(uid: string) {
      this.busy = true
      try {
        const r = await useGameApi().homeSell(uid)
        this.selected = null
        this.apply(r)
        useState<any>('kk_socket_send').value?.('state.resync', {})
        return r.refund_ngn_minor
      } finally {
        this.busy = false
      }
    }
  }
})
