// Graphics quality: 'high' (default on desktop) or 'low' (default on touch).
// Low = dpr 1, no shadows, smaller detailed-house radius, lighter rain.
// Stored per browser; changing it reloads the page so the city rebuilds.
export type Quality = 'high' | 'low'
export function getQuality(): Quality {
  if (typeof window === 'undefined') return 'high'
  try {
    const q = localStorage.getItem('kk_quality')
    if (q === 'low' || q === 'high') return q
  } catch {}
  return matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high'
}
export function setQuality(q: Quality) {
  try {
    localStorage.setItem('kk_quality', q)
  } catch {}
  location.reload()
}
