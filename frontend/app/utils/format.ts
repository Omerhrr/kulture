/** In-game money = k-sats (whole units, deposited with Lightning sats:
 * 1 sat = 1,000 k-sats). Display just groups the whole number. */
export function fmtKsats(ksats: number) {
  return `${Math.round(ksats).toLocaleString('en')} ks`
}

/** Compact k-sats for tight buttons: 870k ks, 6.6M ks. */
export function fmtKsatsShort(ksats: number) {
  const a = Math.abs(ksats)
  if (a >= 1_000_000) return `${+(ksats / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M ks`
  if (a >= 1_000) return `${Math.round(ksats / 1_000)}k ks`
  return fmtKsats(ksats)
}
