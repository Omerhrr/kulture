import { defineStore } from 'pinia'
import type { InteractionOption } from '~/types'
import { useStoryStore } from '~/stores/story'

export const useUiStore = defineStore('ui', {
  state: () => ({
    openPanel: '' as '' | 'shop' | 'inventory' | 'jobs' | 'ledger' | 'pos',
    interaction: null as { entity_id: string; entity_name: string; options: InteractionOption[] } | null,
    dialogue: null as { npcName: string; text: string; engine: string } | null,
    /** story lines waiting to be read, one card per line (stores/story) */
    story: [] as Array<{ name: string; role: string; text: string }>,
    toast: '' as string,
    toastKind: 'info' as 'info' | 'success' | 'error'
  }),
  getters: {
    anyBlocking: (s) => !!s.openPanel || !!s.interaction || !!s.dialogue || s.story.length > 0
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
      this.story = []
    },
    /** a story character speaks: their lines replace any small talk */
    say(name: string, role: string, lines: string[]) {
      this.dialogue = null
      this.story.push(...lines.map((text) => ({ name, role, text })))
    },
    nextLine() {
      this.story.shift()
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
        // the story first: if this person has your next chapter, they say so
        // (and the AI small talk waits until another time)
        if (await useStoryStore().talk(proximity.code)) {
          this.interaction = null
          return
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
