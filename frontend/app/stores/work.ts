// Work + commute state. The server owns shifts and pay; this store mirrors
// it and drives the commute (an automatic car ride to work or home).
import { defineStore } from 'pinia'

export interface Career {
  id: string
  title: string
  place_code: string
  place_name: string
  position: [number, number, number]
  pay_ngn_minor: number
  reputation: number
  shift_seconds: number
}
export interface Shift {
  id: string
  career: string
  title: string
  place_code: string
  status: 'active' | 'paid' | 'left_early'
  started_at: string
  elapsed_seconds: number
  required_seconds: number
  tasks_done: number
  tasks: string[]
  pay_ngn_minor: number
  paid_ngn_minor: number
}
export interface Commute {
  active: boolean
  dest: 'work' | 'home' | 'place'
  code: string
  name: string
  to: [number, number]
  from: [number, number]
  vehicle: string
  progress: number
  eta: number
  msg: string
  view: 'chase' | 'side' | 'top'
  returning: boolean
}

const CAREER_KEY = 'kk_career'

export const useWorkStore = defineStore('work', {
  state: () => ({
    careers: [] as Career[],
    shift: null as Shift | null,
    careerId: '' as string,
    syncedAt: 0,
    commute: null as Commute | null,
    lastResult: null as Shift | null,
    busy: false
  }),
  getters: {
    career(s): Career | undefined {
      return s.careers.find((c) => c.id === s.careerId)
    }
  },
  actions: {
    async refresh() {
      try {
        this.careerId = localStorage.getItem(CAREER_KEY) || this.careerId
      } catch {}
      const r = await useGameApi().workState()
      this.careers = r.careers
      this.shift = r.shift
      this.syncedAt = performance.now()
      if (r.shift && !this.careerId) this.careerId = r.shift.career
    },
    choose(id: string) {
      this.careerId = id
      try {
        localStorage.setItem(CAREER_KEY, id)
      } catch {}
    },
    /** live elapsed seconds (server value + time since last sync) */
    elapsed(): number {
      if (!this.shift) return 0
      return this.shift.elapsed_seconds + (performance.now() - this.syncedAt) / 1000
    },
    async clockIn() {
      if (!this.careerId) return
      this.busy = true
      try {
        const r = await useGameApi().clockIn(this.careerId)
        this.shift = r.shift
        this.syncedAt = performance.now()
        this.lastResult = null
      } finally {
        this.busy = false
      }
    },
    async task() {
      const r = await useGameApi().workTask()
      this.shift = r.shift
      this.syncedAt = performance.now()
    },
    async clockOut() {
      this.busy = true
      try {
        const r = await useGameApi().clockOut()
        this.lastResult = r.shift
        this.shift = null
        // balance comes from the server snapshot
        useState<any>('kk_socket_send').value?.('state.resync', {})
        return r.shift as Shift
      } finally {
        this.busy = false
      }
    }
  }
})
