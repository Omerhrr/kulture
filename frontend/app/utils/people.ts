// people - who a person is, as data: gender, skin, face + build sliders and
// what they wear. Built into a 3D person by utils/humanBody + utils/outfits.
//
// - fromSimLook: the player's saved look (stores/sim) -> PersonLook
// - randomLook:  a stable everyday person for an NPC / passer-by id
// - legacyLook:  the older avatar props (shirt / trouser / hairStyle...)
import type { BeardStyle, BottomStyle, HairStyle, Outfit, ShoeStyle, TopStyle } from './outfits'

export interface PersonLook {
  female: boolean
  skin: string
  outfit: Outfit
  /** face + build sliders 0..1 (morph weights, see humanBody) */
  shape: Record<string, number>
}

export const SHAPES = ['heavy', 'slim', 'muscular', 'noseWide', 'noseFlare', 'noseSmall', 'lipsFull', 'mouthWide', 'jawWide', 'chinStrong', 'cheekbones', 'eyesBig', 'forehead', 'earsSmall', 'headRound', 'headOval', 'headSquare'] as const

export const SKIN_TONES = ['#3a2216', '#4a2e1e', '#5e3a26', '#6e4630', '#7a4e33', '#8a5a3a', '#94603e', '#b07a52', '#c9946a']
export const CLOTH_COLORS = ['#f2f2f0', '#1d1c1f', '#2f5fa8', '#1f2a44', '#b23a48', '#2e7d5b', '#e0a020', '#5a3a7a', '#e86a2c', '#3a7d8a', '#8a6a3a', '#d86a8a', '#6a8a2a', '#c9b78e', '#7a7a7e']
export const BOTTOM_COLORS = ['#2b3440', '#3a4a6e', '#1d1c1f', '#c9b78e', '#5a5a5e', '#6b4a2f', '#2e4a6e', '#f2f2f0', '#7a2a2a']
export const SHOE_COLORS = ['#f2f0ea', '#1d1c1f', '#6b4a2f', '#2a1c14', '#b23a48', '#2f5fa8', '#c9b78e']
export const HAIR_COLORS = ['#141114', '#2a1a10', '#3a2414', '#6b3e1e', '#9a6a2a', '#7a7a7a']

const hash = (id: number, k: number) => {
  const x = Math.sin(id * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const pick = <T>(a: readonly T[], id: number, k: number): T => a[Math.floor(hash(id, k) * a.length) % a.length]!

/** A stable everyday person for an id (crowd, NPCs, passengers). */
export function randomLook(id: number, female: boolean): PersonLook {
  const top: TopStyle = pick(female ? (['tee', 'longsleeve', 'shirt', 'tank', 'tee'] as const) : (['tee', 'polo', 'shirt', 'longsleeve', 'tee', 'polo'] as const), id, 3)
  const bottom: BottomStyle = pick(female ? (['skirt', 'jeans', 'trousers', 'skirt', 'shorts'] as const) : (['jeans', 'trousers', 'jeans', 'shorts'] as const), id, 4)
  const shoes: ShoeStyle = pick(['sneakers', 'sneakers', 'shoes', 'sandals', 'boots'] as const, id, 5)
  const hair: HairStyle = pick(female ? (['braids', 'cornrows', 'afro', 'puff', 'locs', 'braids'] as const) : (['lowcut', 'fade', 'lowcut', 'afro', 'cornrows', 'locs', 'bald'] as const), id, 6)
  const beard: BeardStyle = female ? 'none' : pick(['none', 'stubble', 'none', 'full', 'stubble'] as const, id, 7)
  const shape: Record<string, number> = {}
  // a little of everything, different for everyone
  const build = hash(id, 8)
  if (build < 0.3) shape.slim = 0.2 + hash(id, 9) * 0.5
  else if (build > 0.72) shape.heavy = 0.15 + hash(id, 10) * 0.55
  if (!female && hash(id, 11) > 0.6) shape.muscular = 0.2 + hash(id, 12) * 0.5
  for (const [k, i] of [['noseWide', 13], ['lipsFull', 14], ['cheekbones', 15], ['jawWide', 16], ['eyesBig', 17], ['chinStrong', 18], ['forehead', 19]] as const) {
    const v = hash(id, i)
    if (v > 0.45) shape[k] = (v - 0.45) * 1.2
  }
  shape[pick(['headRound', 'headOval', 'headSquare'] as const, id, 20)] = 0.2 + hash(id, 21) * 0.4
  return {
    female,
    skin: pick(SKIN_TONES, id, 1),
    shape,
    outfit: {
      top,
      topColor: pick(CLOTH_COLORS, id, 22),
      bottom,
      bottomColor: pick(BOTTOM_COLORS, id, 23),
      shoes,
      shoeColor: pick(SHOE_COLORS, id, 24),
      hair,
      hairColor: hash(id, 25) < 0.75 ? '#141114' : pick(HAIR_COLORS, id, 26),
      beard
    }
  }
}

/** Old hairstyle names -> current ones (saves made before the update). */
export function modernHair(h: string | undefined, female: boolean): HairStyle {
  if (h === 'cap' || !h) return female ? 'braids' : 'lowcut'
  return h as HairStyle
}

/** The older avatar props -> a PersonLook (no cultural / religious wear). */
export function legacyLook(o: {
  female?: boolean
  skin?: string
  shirt?: string
  trouser?: string
  hairStyle?: string
  hairColor?: string
  outfit?: string
  beard?: boolean
  seed: number
}): PersonLook {
  const female = o.female ?? (o.outfit === 'dress' || o.hairStyle === 'braids')
  const base = randomLook(o.seed, female)
  return {
    ...base,
    skin: o.skin ?? base.skin,
    outfit: {
      ...base.outfit,
      // an old "kaftan" or "dress" becomes everyday modern clothes
      top: o.outfit === 'kaftan' ? 'shirt' : base.outfit.top,
      topColor: o.shirt ?? base.outfit.topColor,
      bottom: o.outfit === 'dress' ? 'skirt' : base.outfit.bottom === 'skirt' && !female ? 'trousers' : base.outfit.bottom,
      bottomColor: o.trouser && o.trouser !== o.shirt ? o.trouser : base.outfit.bottomColor,
      hair: o.hairStyle ? modernHair(o.hairStyle, female) : base.outfit.hair,
      hairColor: o.hairColor ?? base.outfit.hairColor,
      beard: female ? 'none' : o.beard === undefined ? base.outfit.beard : o.beard ? 'full' : 'none'
    }
  }
}

/** The player's saved look (stores/sim Look) -> PersonLook. */
export function fromSimLook(l: {
  body?: string
  skin?: string
  hair?: string
  hairColor?: string
  top?: string
  bottom?: string
  topStyle?: string
  bottomStyle?: string
  shoes?: string
  shoeColor?: string
  beard?: string
  outfit?: string
  shape?: Record<string, number>
}): PersonLook {
  const female = l.body === 'woman'
  return {
    female,
    skin: l.skin ?? '#6e4630',
    shape: { ...(l.shape ?? {}) },
    outfit: {
      top: (l.topStyle as TopStyle) ?? (l.outfit === 'kaftan' ? 'shirt' : 'tee'),
      topColor: l.top ?? '#2f5fa8',
      bottom: (l.bottomStyle as BottomStyle) ?? (l.outfit === 'dress' ? 'skirt' : 'jeans'),
      bottomColor: l.bottom && l.bottom !== l.top ? l.bottom : '#2b3440',
      shoes: (l.shoes as ShoeStyle) ?? 'sneakers',
      shoeColor: l.shoeColor ?? '#f2f0ea',
      hair: modernHair(l.hair, female),
      hairColor: l.hairColor ?? '#141114',
      beard: female ? 'none' : ((l.beard as BeardStyle) ?? 'none')
    }
  }
}

/** A stable key for a look (rebuild the 3D person when it changes). */
export const lookKey = (l: PersonLook) => JSON.stringify(l)
