// Sim state: who you are (character creator) and how you feel (needs).
// Life-sim layer on top of the server economy. Needs are a local, cosmetic
// simulation (like The Sims): they decay with game time, objects at home
// refill them, and together they set your mood. Persisted per browser.
import { defineStore } from 'pinia'
import type { BeardStyle, BottomStyle, HairStyle, ShoeStyle, TopStyle } from '~/utils/outfits'
import { fromSimLook } from '~/utils/people'

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
  hair: HairStyle
  hairColor: string
  beard: BeardStyle
  /** garments (utils/outfits) and their colours */
  topStyle: TopStyle
  top: string
  bottomStyle: BottomStyle
  bottom: string
  shoes: ShoeStyle
  shoeColor: string
  /** face + build sliders 0..1 (utils/people SHAPES) */
  shape: Record<string, number>
  /** older saves only (kaftan / dress / shirt): migrated on load */
  outfit?: string
}
export const DREAMS = [
  { id: 'oga', icon: '👔', name: 'Oga at the Top', blurb: 'Reach the top level of any career.' },
  { id: 'landlord', icon: '🏡', name: 'Barnawa Landlord', blurb: 'Build a net worth of 100M k-sats.' },
  { id: 'trader', icon: '🧵', name: 'Kantin Kwari King', blurb: 'Run a stall that never closes at the textile market.' },
  { id: 'padi', icon: '🤝', name: "Everybody's Padi", blurb: 'Become best friends with 4 people.' },
  { id: 'sats', icon: '⚡', name: 'Sats Stacker', blurb: 'Pay for 10 things with Lightning.' }
]
/** The backgrounds the game gives (backend character_service BIRTHS): what
 *  each one really comes with. Nobody chooses theirs. */
export const BIRTHS = [
  { id: 'nepo', icon: '💰', name: 'Well-off family', blurb: 'Daddy knows people.', perk: 'Your own flat, first rent already paid', cash: '+3,000,000 ks from your family' },
  { id: 'middle', icon: '📚', name: 'Middle class', blurb: 'Civil-servant parents. Solid.', perk: "A room in your family's house", cash: '+1,000,000 ks to get you started' },
  { id: 'hustle', icon: '🛺', name: 'Self-made', blurb: 'Nothing handed to you. Everything ahead of you.', perk: "A corner of your family's house", cash: 'No head start - you make your own way' }
]
export interface Home {
  area: string
  x: number
  z: number
}

// Saved per player (`kk_sim_v1:<player id>`) so two accounts on one browser
// never share or overwrite each other's character. The old unscoped key is
// adopted once by the first account that loads after the upgrade.
const KEY = 'kk_sim_v1'
const keyFor = (owner: string) => (owner ? `${KEY}:${owner}` : KEY)
interface Saved {
  created: boolean
  name: string
  look: Look
  dream: string
  birth: string
  /** the home the game gave you (server) */
  home: Home | null
  needs: Record<NeedKey, number>
  lastHour: number | null
  tourDone: boolean
}
const fresh = (): Saved => ({
  created: false,
  name: '',
  look: { body: 'man', skin: '#6e4630', hair: 'lowcut', hairColor: '#141114', beard: 'none', topStyle: 'polo', top: '#2f5fa8', bottomStyle: 'jeans', bottom: '#3a4a6e', shoes: 'sneakers', shoeColor: '#f2f0ea', shape: {} },
  dream: 'oga',
  birth: 'middle',
  home: null,
  needs: { hunger: 80, energy: 85, fun: 70, social: 60, hygiene: 90, bladder: 75 },
  lastHour: null,
  tourDone: false
})

/** Saves from before the outfit system: everyday clothes instead of the
 *  retired kaftan / gown, current hairstyle names, default shoes. */
function migrateLook(l: Partial<Look> & Record<string, any>): Look {
  const p = fromSimLook(l)
  return {
    body: l.body === 'woman' ? 'woman' : 'man',
    skin: p.skin,
    hair: p.outfit.hair,
    hairColor: p.outfit.hairColor,
    beard: p.outfit.beard ?? 'none',
    topStyle: p.outfit.top,
    top: p.outfit.topColor,
    bottomStyle: p.outfit.bottom,
    bottom: p.outfit.bottomColor,
    shoes: p.outfit.shoes,
    shoeColor: p.outfit.shoeColor,
    shape: p.shape
  }
}

export const useSimStore = defineStore('sim', {
  state: () => ({
    ...fresh(),
    /** what the player is doing right now (eating, sleeping, ...) */
    activity: null as null | { id: string; label: string; need: NeedKey; gain: number; dur: number; t: number },
    cleanScreen: false,
    /** player id whose save this is ('' until loaded) */
    owner: ''
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
    /** load the save of `owner` (defaults to the last signed-in player) */
    load(owner?: string) {
      try {
        owner = owner ?? localStorage.getItem('kk_player_id') ?? ''
        let raw = localStorage.getItem(keyFor(owner))
        if (!raw && owner) {
          raw = localStorage.getItem(KEY) // pre-upgrade save: adopt it once
          if (raw) {
            localStorage.setItem(keyFor(owner), raw)
            localStorage.removeItem(KEY)
          }
        }
        const saved = raw ? JSON.parse(raw) : {}
        delete saved.traits // retired: the game gives you a life, you don't pick traits
        if (saved.look) saved.look = migrateLook(saved.look)
        Object.assign(this, { ...fresh(), ...saved }, { owner })
      } catch {}
    },
    /** the character as the server keeps it (look, name, the life it gave) */
    applyCharacter(c: { name: string; look: Partial<Look>; birth: string; dream: string; home: Home }) {
      this.name = c.name
      if (c.look && Object.keys(c.look).length) this.look = migrateLook(c.look)
      this.birth = c.birth
      this.dream = c.dream
      this.home = c.home
      this.created = true
      this.save()
    },
    /** Who am I on the server? 'existing' (loaded), 'imported' (an older Sim
     *  from this browser, uploaded once with the life it had) or 'none' (go
     *  through the character creator). */
    async syncCharacter(): Promise<'existing' | 'imported' | 'none'> {
      const api = useGameApi()
      try {
        this.applyCharacter(await api.apiGet<any>('/character'))
        return 'existing'
      } catch (e: any) {
        if (e?.code !== 'no_character') throw e
      }
      if (this.created && this.name) {
        const c = await api.apiPost<any>('/character', { name: this.name, look: this.look, legacy: { birth: this.birth, dream: this.dream } })
        this.applyCharacter(c)
        return 'imported'
      }
      this.created = false
      return 'none'
    },
    save() {
      try {
        const { created, name, look, dream, birth, home, needs, lastHour, tourDone } = this
        localStorage.setItem(keyFor(this.owner), JSON.stringify({ created, name, look, dream, birth, home, needs, lastHour, tourDone }))
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
        const rate = DECAY[n.key]
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
