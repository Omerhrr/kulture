// wardrobe - everyday colours for people the game spawns (crowd, NPCs,
// passengers): a stable pick per person id. What they wear and how they
// look in 3D is utils/people + utils/outfits.

export interface Look {
  skin: string
  top: string
  bottom: string
  hair?: string
}

const SKINS = ['#3a2216', '#4a2a18', '#5a3420', '#6e4630', '#7a4e33', '#8a5a3a', '#9c6a46', '#b07a52']
const TOPS = ['#2e7d5b', '#3f6fae', '#b8392e', '#e0b13a', '#efe8d6', '#7a4a8a', '#1f2a44', '#c46a2a', '#2b2b2f', '#d86a8a', '#3a7d8a', '#8a6a3a', '#f2f2f0', '#6a8a2a', '#a83a6a', '#2a5a3a']
const BOTTOMS = ['#2b3440', '#1d1f24', '#4a3a2a', '#efe8d6', '#2e4a6e', '#5a5a5e', '#c9b78e', '#3a3a2a', '#7a2a2a', '#2f5fa8']
const HAIRS = ['#141114', '#141114', '#141114', '#2a1a10', '#3a2414', '#6b3e1e', '#9a6a2a', '#7a7a7a']

/** A deterministic everyday look for person #id (crowd / NPCs). */
export function lookFor(id: number, _female: boolean): Look {
  const h = (k: number) => {
    const x = Math.sin(id * 127.1 + k * 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  const pick = <T>(a: T[], k: number) => a[Math.floor(h(k) * a.length) % a.length]!
  return { skin: pick(SKINS, 1), hair: pick(HAIRS, 12), top: pick(TOPS, 2), bottom: pick(BOTTOMS, 3) }
}
