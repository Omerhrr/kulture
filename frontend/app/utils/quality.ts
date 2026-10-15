// Graphics quality: 'high' (default on desktop) or 'low' (default on touch
// devices and on weak hardware: <=4 GB RAM or <=4 CPU cores).
// Low = dpr 1, no shadows, shorter view distance, fewer cars/people,
// smaller detailed-house radius, lighter rain.
// Stored per browser; changing it reloads the page so the city rebuilds.
export type Quality = 'high' | 'low'
export function getQuality(): Quality {
  if (typeof window === 'undefined') return 'high'
  try {
    const q = localStorage.getItem('kk_quality')
    if (q === 'low' || q === 'high') return q
  } catch {}
  const nav = navigator as Navigator & { deviceMemory?: number }
  if ((nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency ?? 8) <= 4) return 'low'
  return matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high'
}
export function setQuality(q: Quality) {
  try {
    localStorage.setItem('kk_quality', q)
  } catch {}
  location.reload()
}
/** per-tier budgets read by the scene */
export function perf() {
  const low = getQuality() === 'low'
  return {
    low,
    /** camera far plane (m) – everything past it is culled */
    far: low ? 2600 : 9000,
    /** fog never reaches further than this, hiding the cull edge */
    fogMax: low ? 2200 : 99999,
    /** detailed crowd figures near the player */
    lodPeople: low ? 6 : 12,
    lodRange: low ? 34 : 48,
    /** ms between mounting each heavy system after the city appears */
    stagger: low ? 450 : 200,
  }
}
