// Sim state: who you are (character creator) and how you feel (needs).
// Life-sim layer on top of the server economy. Needs are a local, cosmetic
// simulation (like The Sims): they decay with game time, objects at home
// refill them, and together they set your mood. Persisted per browser.
import { defineStore } from 'pinia'

export type NeedKey = 'hunger' | 'energy' | 'fun' | 'social' | 'hygiene' | 'bladder'
export const NEEDS: Array<{ key: NeedKey; label: string; icon: string; hint: string }> = [
  { key: 'hunger', label: 'Hunger', icon: '🍲', hint: 'Eat at the fridge or cooker, or buy food' },
  { key: 'energy', label: 'Energy', icon: '⚡', hint: 'Sleep in your bed' },
  { key: 'fun', label: 'Fun', icon: '🎉', hint: 'Watch TV, drive around, explore' },
  { key: 'social', label: 'Social', icon: '💬', hint: 'Talk to people in the city' },
  { key: 'hygiene', label: 'Hygiene', icon: '🫧', hint: 'Take a baff (shower)' },
  { key: 'bladder', label: 'Bladder', icon: '🚽', hint: 'Use the toilet' }
]
// points lost per in-game hour
const DECAY: Record<NeedKey, number> = { hunger: 5.5, energy: 4, fun: 5, social: 3.5, hygiene: 3, bladder: 7 }

export interface Look {
  body: 'man' | 'woman'
  skin: string
  hair: 'cap' | 'afro' | 'braids' | 'bald'
  hairColor: string
  outfit: 'kaftan' | 'dress' | 'shirt'
  top: string
  bottom: string
  /** worn extras: phone, sunglasses, cap, headphones, backpack, bag, watch */
  gadgets?: string[]
  /** ankara print strength 0..1 (Character Studio) */
  print?: number
  /** body: modern clothes, or traditional (caftan for men, hijab for women) */
  dress?: 'modern' | 'traditional'
}
export interface Trait {
  id: string
  icon: string
  name: string
  blurb: string
  /** decay multipliers (smaller = need drops slower) */
  mod?: Partial<Record<NeedKey, number>>
}
export const TRAITS: Trait[] = [
  { id: 'hustler', icon: '💼', name: 'Hustler', blurb: 'Sees money everywhere. Jobs pay a bit more and bosses notice.' },
  { id: 'foodie', icon: '🍲', name: 'Foodie', blurb: 'Lives for tuwo and suya. Meals refill more.', mod: { hunger: 1.15 } },
  { id: 'socialite', icon: '🎊', name: 'Owambe Spirit', blurb: 'Always ready to spray money. Loves company, gets bored quick.', mod: { social: 1.3, fun: 1.2 } },
  { id: 'gym', icon: '💪', name: 'Gym Rat', blurb: 'Leg day every day. Energy lasts longer.', mod: { energy: 0.8 } },
  { id: 'chill', icon: '😌', name: 'Chill', blurb: 'Nothing shakes you. Fun drains slowly.', mod: { fun: 0.75 } },
  { id: 'sleepy', icon: '😴', name: 'Sleepyhead', blurb: 'Could sleep through a generator. Needs more rest.', mod: { energy: 1.3 } },
  { id: 'neat', icon: '🧼', name: 'Neat Freak', blurb: 'Always fresh. Hygiene drops slower.', mod: { hygiene: 0.7 } },
  { id: 'techie', icon: '💻', name: 'Techie', blurb: 'Lightning native. Knows sats from naira.' }
]
export const DREAMS = [
  { id: 'oga', icon: '👔', name: 'Oga at the Top', blurb: 'Reach the top level of any career.' },
  { id: 'landlord', icon: '🏡', name: 'Barnawa Landlord', blurb: 'Build a net worth of 100M k-sats.' },
  { id: 'trader', icon: '🧵', name: 'Kantin Kwari King', blurb: 'Run a stall that never closes at the textile market.' },
  { id: 'padi', icon: '🤝', name: "Everybody's Padi", blurb: 'Become best friends with 4 people.' },
  { id: 'sats', icon: '⚡', name: 'Sats Stacker', blurb: 'Pay for 10 things with Lightning.' }
]
export const BIRTHS = [
  { id: 'nepo', icon: '💰', name: 'Nepo Baby!', blurb: 'Daddy knows people.', perk: 'Furnished flat in Malali, Daddy pays the rent', cash: 'Extra starting money' },
  { id: 'hustle', icon: '🛺', name: 'Self-made', blurb: 'Started from Tudun Wada.', perk: 'A small room and a big heart', cash: 'Hustle bonus on your first job' },
  { id: 'middle', icon: '📚', name: 'Middle Class', blurb: 'Civil-servant parents. Solid.', perk: 'A tidy flat in Barnawa', cash: 'Steady start' }
]

const KEY = 'kk_sim_v1'
interface Saved {
  created: boolean
  name: string
  look: Look
  traits: string[]
  dream: string
  birth: string
  needs: Record<NeedKey, number>
  lastHour: number | null
  tourDone: boolean
}
const fresh = (): Saved => ({
  created: false,
  name: '',
  look: { body: 'man', skin: '#7a4e33', hair: 'cap', hairColor: '#141114', outfit: 'kaftan', top: '#2e7d5b', bottom: '#2b3440' },
  traits: [],
  dream: 'oga',
  birth: 'middle',
  needs: { hunger: 80, energy: 85, fun: 70, social: 60, hygiene: 90, bladder: 75 },
  lastHour: null,
  tourDone: false
})

export const useSimStore = defineStore('sim', {
  state: () => ({
    ...fresh(),
    /** what the player is doing right now (eating, sleeping, ...) */
    activity: null as null | { id: string; label: string; need: NeedKey; gain: number; dur: number; t: number },
    cleanScreen: false
  }),
  getters: {
    mood(s): { label: string; emoji: string; tone: 'good' | 'ok' | 'bad' } {
      const v = Object.values(s.needs)
      const low = Math.min(...v)
      const avg = v.reduce((a, b) => a + b, 0) / v.length
      const score = avg * 0.6 + low * 0.4
      if (score > 75) return { label: 'Very happy', emoji: '😄', tone: 'good' }
      if (score > 58) return { label: 'Happy', emoji: '🙂', tone: 'good' }
      if (score > 40) return { label: 'Fine', emoji: '😐', tone: 'ok' }
      if (score > 24) return { label: 'Uncomfortable', emoji: '😕', tone: 'bad' }
      return { label: 'Miserable', emoji: '😣', tone: 'bad' }
    },
    /** the most urgent need (for the goal chip) */
    urgent(s): NeedKey | null {
      let k: NeedKey | null = null
      let lo = 35
      for (const n of NEEDS) if (s.needs[n.key] < lo) (lo = s.needs[n.key]), (k = n.key)
      return k
    }
  },
  actions: {
    load() {
      try {
        const raw = localStorage.getItem(KEY)
        if (raw) Object.assign(this, { ...fresh(), ...JSON.parse(raw) })
      } catch {}
    },
    save() {
      try {
        const { created, name, look, traits, dream, birth, needs, lastHour, tourDone } = this
        localStorage.setItem(KEY, JSON.stringify({ created, name, look, traits, dream, birth, needs, lastHour, tourDone }))
      } catch {}
    },
    /** advance needs by the game-clock delta (hours, wraps at 24) */
    tick(hour: number) {
      if (this.lastHour === null) {
        this.lastHour = hour
        return
      }
      let dh = hour - this.lastHour
      if (dh < 0) dh += 24
      this.lastHour = hour
      if (dh <= 0 || dh > 12) return
      for (const n of NEEDS) {
        let rate = DECAY[n.key]
        for (const t of this.traits) rate *= TRAITS.find((x) => x.id === t)?.mod?.[n.key] ?? 1
        // busy refilling this need: no decay for it
        if (this.activity?.need === n.key) continue
        this.needs[n.key] = Math.max(0, this.needs[n.key] - rate * dh)
      }
    },
    bump(need: NeedKey, amount: number) {
      this.needs[need] = Math.max(0, Math.min(100, this.needs[need] + amount))
    },
    reset() {
      Object.assign(this, fresh())
      this.save()
    }
  }
})
