// Shared handle on the street crowd so other systems (the high-detail LOD
// renderer) can read pedestrians without owning them.
export interface CrowdLook {
  shirt: string
  trouser: string
  skin: string
  hair: string
}
export const crowd = { peds: [] as any[] }

const JOBS = [
  ['tailor', 'Kantin Kwari market'],
  ['nurse', 'the General Hospital'],
  ['keke driver', 'Kawo motor park'],
  ['student', 'KASU'],
  ['teacher', 'the primary school on my street'],
  ['trader', 'Central Market'],
  ['mechanic', 'the workshop by the filling station'],
  ['civil servant', 'the State Secretariat'],
  ['phone repairer', 'Ahmadu Bello Way'],
  ['baker', 'my mama’s bakery in Barnawa']
] as const

/** a stable everyday identity for a pedestrian */
export function persona(id: number) {
  const [job, place] = JOBS[(id * 7 + 3) % JOBS.length]
  return { job, place }
}

/** what they say about their day, given what they are doing right now */
export function routineLine(id: number, hour: number, doing: 'seated' | 'commute' | 'walk'): string {
  const { job, place } = persona(id)
  const a = /^[aeiou]/.test(job) ? 'an' : 'a'
  if (doing === 'seated') return hour < 15 ? `Lunch break small. I'm ${a} ${job} at ${place}, back to work by two.` : `Resting my legs before I go home. Long day at ${place}.`
  if (doing === 'commute') return hour < 12 ? `Can't stop o, I'm late for work at ${place}!` : `Closing time! Heading home from ${place}.`
  if (hour < 6 || hour >= 21) return `I'm ${a} ${job}. Just getting home, ${place} wore me out today.`
  return `I'm ${a} ${job} at ${place}. Running errands before the next shift.`
}
