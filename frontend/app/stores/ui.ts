import { defineStore } from 'pinia'
import type { InteractionOption } from '~/types'

export const useUiStore = defineStore('ui', {
  state: () => ({
    openPanel: '' as '' | 'shop' | 'inventory' | 'jobs' | 'ledger' | 'pos',
    interaction: null as { entityId: string; entityName: string; options: InteractionOption[] } | null,
    dialogue: null as { npcName: string; text: string; engine: string } | null,
    toast: '' as string,
    toastKind: 'info' as 'info' | 'success' | 'error'
  }),
  getters: {
    anyBlocking: (s) => !!s.openPanel || !!s.interaction || !!s.dialogue
  },
  actions: {
    open(panel: typeof this.openPanel) {
      this.openPanel = this.openPanel === panel ? '' : panel
      if (this.openPanel) {
        this.interaction = null
        this.dialogue = null
      }
    },
    closeAll() {
      this.openPanel = ''
      this.interaction = null
      this.dialogue = null
    },
    showToast(msg: string, kind: 'info' | 'success' | 'error' = 'info') {
      this.toast = msg
      this.toastKind = kind
      setTimeout(() => (this.toast = ''), 3800)
    },
    async interactWith(
      proximity: { entityId: string; name: string; code: string },
      position?: [number, number, number]
    ) {
      const payments = usePaymentsStore()
      let pos = position
      if (!pos) {
        try {
          pos = useState<[number, number, number]>('kk_player_pos').value
        } catch {
          pos = [0, 0, 0]
        }
      }
      try {
        const result = await useGameApi().interact(proximity.entityId, pos!)
        // talk / look-only spots: the dialogue arrives over the socket, so a
        // sheet with a single non-action button is just an extra click
        const actionable = result.options.filter((o: InteractionOption) => ['shop', 'job_board', 'pos_kiosk'].includes(o.kind))
        if (actionable.length === 0) {
          this.interaction = null
          const first = result.options[0]
          if (first && !/^talk to/i.test(first.label)) this.showToast(first.label, 'info')
        } else {
          this.interaction = { ...result, options: [...actionable, ...result.options.filter((o: InteractionOption) => !actionable.includes(o))] }
        }
        // fire the WS event too so the DSH shopkeeper reacts (dialogue via WS)
        useGameSocketSend()('entity.interact', {
          entity_id: proximity.entityId,
          message: ''
        })
      } catch (e: any) {
        this.showToast(e.message || 'Interaction failed', 'error')
      }
    },
    chooseOption(opt: InteractionOption) {
      const payments = usePaymentsStore()
      if (opt.kind === 'shop' && opt.business_id) {
        payments
          .openForBusiness(opt.business_id)
          .then(() => {
            this.openPanel = 'shop'
          })
          .catch((e) => this.showToast(e.message || 'Could not open shop', 'error'))
        this.interaction = null
      } else if (opt.kind === 'job_board') {
        this.open('jobs')
        this.interaction = null
      } else if (opt.kind === 'pos_kiosk') {
        this.open('pos')
        this.interaction = null
      } else {
        this.showToast(opt.label, 'info')
        this.interaction = null
      }
    }
  }
})

/** Helper to grab the socket sender without pinia circularity. */
export function useGameSocketSend() {
  // The socket composable is bound on the game page; reuse a singleton ref.
  const send = useState<(type: string, payload: Record<string, unknown>) => boolean>(
    'kk_socket_send',
    () => () => false
  )
  return send.value
}
