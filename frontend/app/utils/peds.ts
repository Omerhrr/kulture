// Pedestrian registry + street conversation. CrowdSystem fills `peds`
// every frame (plain module array, zero reactivity cost); the talk prompt
// scanner and the minimap read it. Conversation lines are local, Kaduna
// flavored and keyed by role so stopping to chat works without a server
// round trip for every passer by.

export type PedKind = 'walker' | 'hawker' | 'vendor' | 'worker' | 'kid' | 'shopper'

export interface PedEntry {
  id: number
  x: number
  z: number
  heading: number
  kind: PedKind
  name: string
  female: boolean
  /** seconds remaining of "paused, talking" state */
  talking: number
  kid: boolean
}

export const pedRegistry: PedEntry[] = []

export function pedRegistryReset() {
  pedRegistry.length = 0
}

export function pedRegistryPush(e: PedEntry) {
  if (pedRegistry.length < 200) pedRegistry.push(e)
}

// ---------------------------------------------------------------- names
const FIRST_M = ['Musa', 'Danladi', 'Nnamdi', 'Chinedu', 'Emeka', 'Yusuf', 'Tunde', 'Ibrahim', 'Sani', 'Uche', 'Bashir', 'Garba', 'Onyeka', 'Kabir', 'Sadiq', 'Abba', 'Bala', 'Sunday', 'Idris', 'Aliyu']
const FIRST_F = ['Fatima', 'Amina', 'Hauwa', 'Ngozi', 'Aisha', 'Zainab', 'Halima', 'Bola', 'Bilkisu', 'Rabi', 'Hadiza', 'Adaeze', 'Lantana', 'Yemisi', 'Kande', 'Ramatu', 'Grace', 'Hajar']
const LAST = ['Abubakar', 'Okafor', 'Bello', 'Eze', 'Yakubu', 'Lawal', 'Nwachukwu', 'Suleiman', 'Adeyemi', 'Mohammed', 'Oyelaran', 'Danjuma', 'Ilori', 'Musa', 'Kolo', 'Umaru', 'Tanko', 'Ojo']
const HON_M = ['Alhaji', 'Mallam', 'Dr.', 'Eng.', '']
const HON_F = ['Hajiya', 'Malama', 'Dr.', 'Madam', '']

export function pedName(female: boolean, seed: number): string {
  const first = female ? FIRST_F[seed % FIRST_F.length] : FIRST_M[(seed >> 1) % FIRST_M.length]
  const last = LAST[(seed >> 3) % LAST.length]
  const hon = female ? HON_F[(seed >> 2) % HON_F.length] : HON_M[(seed >> 2) % HON_M.length]
  return hon ? `${hon} ${first} ${last}` : `${first} ${last}`
}

// ---------------------------------------------------------------- lines
const MORNING = ['Good morning! Sah, hope you slept well?', 'Barka da safiya! The harmattan is coming, you see the wind.', 'Morning o. This Kaduna sun no dey joke at all.']
const AFTERNOON = ['Good afternoon. The heat today, wallahi.', 'How far! You dey find somewhere for this sun?', 'Afternoon. If you pass the market, buy mango for me.']
const EVENING = ['Good evening. The city is calm tonight, e no be like Lagos at all.', 'Evening! Careful on the road, the okadas dey fly tonight.', 'Yau da yamma. I like Kaduna evenings, the breeze from the river.']

const WALKER = ['I dey go broadband office for Ahmadu Bello Way. This city don change.', 'You know the shortcut through Kachia Road? Save you twenty minutes.', 'I work at the textile depot. The trains still run, you hear them at night.', 'Kaduna people are friendly. Just greet them first, that is the culture.', 'If you are new here, visit the museum. Our history is deep.']
const HAWKER = ['Pure water! Buy pure water, ten naira only... okay okay, come back!', 'I sell groundnuts and suya spice. My customers around here know me well.', 'Bols and akara, hot akara! You want? E sweet no be small.', 'The market task is not easy o, but God dey. Rain spoil my goods last week.']
const VENDOR = ['Come, come! Fresh tomatoes from Fadama farm, no chemicals.', 'Today the pepper cost double. Fuel price, you understand.', 'I don sell for this Central Market twenty-two years. I know everybody.', 'My sister, take this one. Kaduna price, not Lagos price!']
const WORKER = ['This block work go finish before rains, insha Allah.', 'Cement price again! The oga said we should manage the mix.', 'I dey lay blocks since six this morning. My back dey cry.', 'When we finish this duplex, the owner promised bonus. We shall see.']
const KID = ['Uncle, you see my new ball? Manchester, I support them!', 'We are playing Morocco. The winning team buys zobo!', 'My teacher says Kaduna means crocodiles. The river ones, long ago!', 'Greeting sir! I am going to buy bread for my mummy.']
const SHOPPER = ['The market is full today. Prices are rising every week.', 'I need to buy fabric for Sallah. Check the west wing stalls.', 'I bought yam and palm oil. Now I am looking for my keke home.', 'Do not buy the thin okro, the one near the gate is fresher.']

function timeLine(hour: number): string {
  const pool = hour < 11 ? MORNING : hour < 16.5 ? AFTERNOON : EVENING
  return pool[Math.floor(Math.random() * pool.length)]
}

function roleLine(kind: PedKind): string {
  const pool =
    kind === 'hawker' ? HAWKER
    : kind === 'vendor' ? VENDOR
    : kind === 'worker' ? WORKER
    : kind === 'kid' ? KID
    : kind === 'shopper' ? SHOPPER
    : WALKER
  return pool[Math.floor(Math.random() * pool.length)]
}

/** A line a pedestrian says when the player stops them. */
export function pedLine(kind: PedKind, hour: number): string {
  const line = Math.random() < 0.45 ? timeLine(hour) : roleLine(kind)
  return Math.random() < 0.5 ? `${hausaGreeting(hour)} ${line}` : line
}

/** Time-appropriate Hausa greeting (Kaduna street manners: greet first). */
export function hausaGreeting(hour: number): string {
  const pool = hour < 11 ? ['Ina kwana?', 'Barka da safiya!', 'Sannu!'] : hour < 16.5 ? ['Ina wuni?', 'Sannu da aiki!', 'Barka da rana!'] : ['Barka da yamma!', 'Sannu!', 'Ina gajiya?']
  return pool[Math.floor(Math.random() * pool.length)]!
}

/** Hour of the day state (set by the day/night cycle). */
export const pedClock = { hour: 8.5 }
