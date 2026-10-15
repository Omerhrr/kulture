// Pure timing logic for the dance battle and the talent show, kept free of
// Vue/three so it can be tested at real speed outside the (slow) 3D page.

export interface Note { lane: number; t: number; hit: boolean | null }
export const HIT_WINDOW = 260 // ms either side of the beat
export const PERFECT = 110

export function makeChart(n = 24, rand: () => number = Math.random): Note[] {
  const out: Note[] = []
  for (let i = 0; i < n; i++) out.push({ lane: Math.floor(rand() * 4), t: 2000 + i * 600 + (i % 3) * 120, hit: null })
  return out
}

/** A tap on `lane` at song time `now` (ms). Returns points (+ on hit, - on a miss tap). */
export function tap(notes: Note[], lane: number, now: number): number {
  const nt = notes.find((x) => x.hit === null && x.lane === lane && Math.abs(x.t - now) < HIT_WINDOW)
  if (!nt) return -20
  nt.hit = true
  return Math.abs(nt.t - now) < PERFECT ? 120 : 90
}

/** Mark notes whose window has passed as missed. */
export function expire(notes: Note[], now: number): void {
  for (const nt of notes) if (nt.hit === null && now > nt.t + HIT_WINDOW) nt.hit = false
}

/** The rival scores 85 per move (beats sloppy, loses to clean): score for everything up to `now`. */
export function rivalScore(notes: Note[], now: number, skill = 0.85): number {
  return Math.round(notes.filter((nt) => now > nt.t).length * 100 * skill)
}

export function songEnd(notes: Note[]): number {
  return notes[notes.length - 1]!.t + 800
}

/** Talent show: a marker swings 0..1; the gold zone is the middle. */
export function markerAt(ms: number, round: number): number {
  return (Math.sin(ms / (260 - round * 40)) + 1) / 2
}
export function judgeHit(pos: number): number {
  return Math.round(100 - Math.abs(pos - 0.5) * 200)
}
