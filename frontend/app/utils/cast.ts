// cast - the named people of the story, in one place: who they are, where
// they work and how they look. Keyed by their world entity code (the
// server's world_entities rows, mirrored in utils/kaduna PLAYABLE_POS).
// The server's NPC agents (backend seed_data NPC_DEFS) carry the same names
// and roles; the story (utils/story) and the guide read from here.
import type { PersonLook } from './people'

export interface CastMember {
  name: string
  /** what they do, in a few words */
  role: string
  /** the world entity where they work */
  post: string
  /** one line for the story card / phone */
  bio: string
  look: PersonLook
}

export const CAST: Record<string, CastMember> = {
  npc_musa: {
    name: 'Mallam Musa',
    role: 'Shopkeeper, Musa\'s Provision Store',
    post: 'musa_shop',
    bio: 'Has kept the store by the Central Market since 1998. Knows everyone, forgets nothing, trusts you a little.',
    look: {
      female: false,
      skin: '#4a2e1e',
      shape: { heavy: 0.35, jawWide: 0.3, forehead: 0.3, headRound: 0.3 },
      outfit: { top: 'shirt', topColor: '#efe8d6', bottom: 'trousers', bottomColor: '#3a3f4a', shoes: 'shoes', shoeColor: '#2a1c14', hair: 'lowcut', hairColor: '#6e6a66', beard: 'full' }
    }
  },
  npc_amina: {
    name: 'Hajiya Amina',
    role: 'Coordinator, Stonetech Square',
    post: 'stonetech_square',
    bio: 'Runs the deliveries at Stonetech Square by the stadium. Brief, friendly, always checking her list.',
    look: {
      female: true,
      skin: '#6e4630',
      shape: { heavy: 0.25, cheekbones: 0.35, headOval: 0.3 },
      outfit: { top: 'longsleeve', topColor: '#3f6fae', bottom: 'skirt', bottomColor: '#1f2a44', shoes: 'shoes', shoeColor: '#6b4a2f', hair: 'puff', hairColor: '#141114', beard: 'none' }
    }
  },
  npc_mama_chidi: {
    name: 'Mama Chidi',
    role: 'Fabric trader, Textile Market',
    post: 'textile_market',
    bio: 'Knows every wax print by name. Honest prices, a warm laugh, and a long memory for customers who disappear.',
    look: {
      female: true,
      skin: '#5e3a26',
      shape: { heavy: 0.45, lipsFull: 0.3, cheekbones: 0.2, headRound: 0.35 },
      outfit: { top: 'shirt', topColor: '#e0a020', bottom: 'skirt', bottomColor: '#5a3a7a', shoes: 'sandals', shoeColor: '#6b4a2f', hair: 'cornrows', hairColor: '#141114', beard: 'none' }
    }
  },
  npc_bashir: {
    name: 'Bashir',
    role: 'Union man, Kawo Motor Park',
    post: 'kawo_motor_park',
    bio: 'NURTW at Kawo. Loud voice, warm heart, knows every route, fare and driver to avoid.',
    look: {
      female: false,
      skin: '#3a2216',
      shape: { muscular: 0.4, heavy: 0.3, jawWide: 0.4, headSquare: 0.35 },
      outfit: { top: 'polo', topColor: '#2e7d5b', bottom: 'trousers', bottomColor: '#5a5a5e', shoes: 'sandals', shoeColor: '#6b4a2f', hair: 'bald', hairColor: '#141114', beard: 'stubble' }
    }
  },
  npc_prof_danjuma: {
    name: 'Professor Danjuma',
    role: 'Economics lecturer, KASU',
    post: 'kasu_gate',
    bio: 'Teaches economics at Kaduna State University and keeps a kiosk at the main gate. Loves a debate about sats.',
    look: {
      female: false,
      skin: '#4a2e1e',
      shape: { slim: 0.2, forehead: 0.45, chinStrong: 0.3, headOval: 0.35 },
      outfit: { top: 'shirt', topColor: '#4a6a8a', bottom: 'trousers', bottomColor: '#2b3440', shoes: 'shoes', shoeColor: '#2a1c14', hair: 'lowcut', hairColor: '#7a7a7a', beard: 'full' }
    }
  },
  npc_tunde: {
    name: 'Tunde',
    role: 'Freight officer, Rigasa Station',
    post: 'rigasa_station',
    bio: 'Timetable-obsessed, scans every package twice, softens for regulars.',
    look: {
      female: false,
      skin: '#7a4e33',
      shape: { chinStrong: 0.4, slim: 0.15, headSquare: 0.3 },
      outfit: { top: 'shirt', topColor: '#1f2a44', bottom: 'trousers', bottomColor: '#1d1c1f', shoes: 'boots', shoeColor: '#1d1c1f', hair: 'fade', hairColor: '#141114', beard: 'none' }
    }
  },
  npc_ngozi: {
    name: 'Ngozi',
    role: 'Shopkeeper, Sabon Tasha Community Shop',
    post: 'sabon_tasha_shop',
    bio: 'Everyone\'s elder sister in Sabon Tasha. Sells on credit to regulars; her tomatoes are the freshest south of the river.',
    look: {
      female: true,
      skin: '#8a5a3a',
      shape: { cheekbones: 0.4, slim: 0.2, eyesBig: 0.25, headOval: 0.3 },
      outfit: { top: 'tee', topColor: '#d86a8a', bottom: 'jeans', bottomColor: '#3a4a6e', shoes: 'sneakers', shoeColor: '#f2f0ea', hair: 'braids', hairColor: '#141114', beard: 'none' }
    }
  }
}
