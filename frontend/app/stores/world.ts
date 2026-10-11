import { defineStore } from 'pinia'
import type { Entity, Region } from '~/types'

export const useWorldStore = defineStore('world', {
  state: () => ({
    region: null as Region | null,
    loading: false,
    worldEvents: [] as { id: string; name: string; description: string; at: number }[],
    activeBanner: '' as string
  }),
  getters: {
    entities: (s) => s.region?.entities ?? [],
    shopEntity: (s) => s.region?.entities.find((e) => e.code === 'musa_shop') ?? null,
    posEntity: (s) => s.region?.entities.find((e) => e.code === 'arewa_pos') ?? null,
    npcEntities: (s) => s.region?.entities.filter((e) => e.entity_type === 'npc') ?? []
  },
  actions: {
    async load() {
      this.loading = true
      try {
        const api = useGameApi()
        this.region = await api.region('ali-akilu-road')
      } finally {
        this.loading = false
      }
    },
    entityById(id: string): Entity | undefined {
      return this.entities.find((e) => e.id === id)
    },
    handleServerEvent(e: any) {
      if (e.type === 'world.event') {
        const p = e.payload || {}
        this.worldEvents.unshift({
          id: p.event_id || String(Date.now()),
          name: p.name || 'Something happened',
          description: p.description || '',
          at: Date.now()
        })
        this.activeBanner = p.description || p.name || ''
        if (this.worldEvents.length > 20) this.worldEvents.pop()
        setTimeout(() => {
          if (this.activeBanner === (p.description || p.name)) this.activeBanner = ''
        }, 9000)
      }
    }
  }
})
