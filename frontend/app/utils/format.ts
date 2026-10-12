/** Simulated naira from kobo (minor units). */
export function fmtNgn(minor: number) {
  return `₦${Math.round(minor / 100).toLocaleString('en-NG')}`
}
