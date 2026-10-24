import { defineStore } from 'pinia'
import type { Job, LedgerEntry, Player, ServerEvent } from '~/types'

export const usePlayerStore = defineStore('player', {
  state: () => ({
    token: '',
    profile: null as Player | null,
    inventory: [] as { item_id: string; code: string; name: string; emoji: string; quantity: number }[],
    jobs: [] as Job[],
    transactions: [] as LedgerEntry[],
    authenticated: false
  }),
  getters: {
    ksatsDisplay: (s) =>
      s.profile ? `${s.profile.ksats_balance.toLocaleString('en')} ks` : '-',
    hasParcel: (s) => s.inventory.some((i) => i.code === 'quest_parcel' && i.quantity > 0)
  },
  actions: {
    setToken(t: string) {
      this.token = t
      localStorage.setItem('kk_token', t)
      this.authenticated = true
    },
    logout() {
      this.token = ''
      this.profile = null
      this.authenticated = false
      localStorage.removeItem('kk_token')
    },
    applyPlayer(p: Player) {
      this.profile = p
    },
    applyInventory(items: any[]) {
      this.inventory = items
    },
    upsertJob(job: Job) {
      const i = this.jobs.findIndex((j) => j.id === job.id)
      if (i >= 0) this.jobs[i] = job
      else this.jobs.unshift(job)
    },
    handleServerEvent(e: ServerEvent) {
      switch (e.type) {
        case 'player.state': {
          const p = e.payload?.player
          if (p) this.applyPlayer(p)
          if (e.payload?.inventory) this.applyInventory(e.payload.inventory.items)
          break
        }
        case 'player.position_corrected': {
          // Movement authority: server reconciled a teleport/over-speed move.
          // Keep the store's view of position authoritative-consistent.
          const pos = e.payload?.position
          if (pos && this.profile) this.profile.position = pos
          break
        }
        case 'inventory.updated': {
          // authoritative refresh follows via player.state usually; fetch to be sure
          useGameApi()
            .inventory()
            .then((r) => this.applyInventory(r.items))
            .catch(() => {})
          break
        }
        case 'job.updated': {
          const api = useGameApi()
          api.myJobs().then((jobs) => (this.jobs = jobs)).catch(() => {})
          api.me().then((p) => this.applyPlayer(p)).catch(() => {})
          break
        }
        case 'payment.status': {
          const api = useGameApi()
          api.me().then((p) => this.applyPlayer(p)).catch(() => {})
          api.transactions().then((t) => (this.transactions = t)).catch(() => {})
          break
        }
      }
    }
  }
})
