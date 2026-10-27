// The main story ("Musa's Promise"): where you are in it, from the server
// (backend services/story_service). Talking to a cast member (utils/cast)
// can hand you the next chapter; what people say plays in the DialogueBox.
import { defineStore } from 'pinia'
import { CAST } from '~/utils/cast'
import { useUiStore } from '~/stores/ui'

export interface StoryState {
  chapter: number
  total: number
  done: boolean
  key?: string
  title: string
  summary: string
  /** talk: go and see the giver · pickup / deliver: the parcel · business: open a shop · free: story over */
  step: 'talk' | 'pickup' | 'deliver' | 'business' | 'shelf' | 'win' | 'shift' | 'free'
  act?: number
  act_title?: string
  have?: number
  need?: number
  game?: string
  /** world entity code to head for (null: anywhere) */
  target: string | null
  giver?: string
  receiver?: string | null
  parcel?: string
  job_id?: string | null
  have_ksats?: number
  need_ksats?: number
  ready?: boolean
  said: Array<{ speaker: string | null; lines: string[] }>
  log: string[]
}

/** the cast member who works at a place (the shop counter counts as them) */
export function castAt(code: string): string | null {
  if (CAST[code]) return code
  for (const [npc, c] of Object.entries(CAST)) if (c.post === code) return npc
  return null
}

export const useStoryStore = defineStore('story', {
  state: () => ({
    s: null as StoryState | null,
    busy: false
  }),
  actions: {
    apply(s: StoryState) {
      this.s = s
      if (s.said?.length) {
        const ui = useUiStore()
        for (const x of s.said) {
          const who = x.speaker ? CAST[x.speaker] : null
          ui.say(who?.name ?? 'Kaduna', who?.role ?? '', x.lines)
        }
      }
    },
    async refresh() {
      try {
        this.apply(await useGameApi().apiGet<StoryState>('/story'))
      } catch {}
    },
    /** you spoke to someone at `code` (a person or their shop) */
    async talk(code: string): Promise<boolean> {
      const npc = castAt(code)
      if (!npc || this.busy) return false
      // only the person who has your next chapter has anything to add
      if (this.s && (this.s.step !== 'talk' || this.s.target !== npc)) return false
      this.busy = true
      try {
        const s = await useGameApi().apiPost<StoryState>('/story/talk', { npc })
        this.apply(s)
        return s.said.length > 0
      } catch (e: any) {
        useUiStore().showToast(e.message || 'Not now', 'info')
        return false
      } finally {
        this.busy = false
      }
    }
  }
})
