/** In-game money = k-sats (whole units, deposited with Lightning sats:
 * 1 sat = 1,000 k-sats). Display just groups the whole number. */
export function fmtKsats(ksats: number) {
  return `${Math.round(ksats).toLocaleString('en')} ks`
}
