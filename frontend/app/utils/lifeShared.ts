// Shared state types for the life / social systems.
export interface SceneState {
  date: { name: string; place: string } | null
  owambe: { partner: string; until: number } | null
  dance: { rival: string } | null
  football: { score: [number, number]; until: number; park: string; cx: number; cz: number } | null
}

/** The city calendar starts on today's real date; kk_day counts game days. */
const DAY0 = new Date()
export function calendarDate(day: number): Date {
  return new Date(DAY0.getTime() + (day - 1) * 86400000)
}
/** Monday = 0 .. Sunday = 6 */
export function weekdayOf(day: number): number {
  return (calendarDate(day).getDay() + 6) % 7
}
