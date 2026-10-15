// Spoken voice for street life, using the browser's built-in speech
// (no downloads). A Hausa voice is used when the device has one; otherwise
// a Nigerian / British English voice reads the Hausa phrases, which comes
// out close enough for greetings and market calls. Volume follows the
// game's sound switch; "Voices" can be turned off in Phone → Settings.

let voices: SpeechSynthesisVoice[] = []
function loadVoices() {
  if (typeof speechSynthesis === 'undefined') return
  voices = speechSynthesis.getVoices()
}
if (typeof window !== 'undefined' && typeof speechSynthesis !== 'undefined') {
  loadVoices()
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices)
}

const PREF = ['ha', 'ha-NG', 'en-NG', 'en-GB', 'en-ZA', 'en-KE', 'en-US', 'en']
function pick(female: boolean): SpeechSynthesisVoice | null {
  for (const lang of PREF) {
    const m = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()))
    if (!m.length) continue
    const byGender = m.find((v) => (female ? /female|woman|zira|susan|hazel|libby|sonia|samantha/i : /male|man|david|george|ryan|daniel|guy/i).test(v.name))
    return byGender ?? m[0]!
  }
  return voices[0] ?? null
}

export function voicesOn(): boolean {
  try {
    return localStorage.getItem('kk_voices') !== 'off' && localStorage.getItem('kk_muted') !== '1'
  } catch {
    return true
  }
}
export function setVoicesOn(on: boolean) {
  try {
    localStorage.setItem('kk_voices', on ? 'on' : 'off')
  } catch {}
  if (!on) speechSynthesis?.cancel()
}

let busyUntil = 0
/** Speak a short line. `priority` lines interrupt ambient chatter. */
export function say(text: string, o: { female?: boolean; volume?: number; rate?: number; pitch?: number; priority?: boolean } = {}) {
  if (typeof speechSynthesis === 'undefined' || !voicesOn() || !text) return
  const now = performance.now()
  if (!o.priority && now < busyUntil) return // don't stack ambient voices
  if (o.priority) speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = pick(!!o.female)
  if (v) {
    u.voice = v
    u.lang = v.lang
  }
  u.volume = Math.max(0, Math.min(1, o.volume ?? 0.9))
  u.rate = o.rate ?? 0.95
  u.pitch = o.pitch ?? (o.female ? 1.15 : 0.9)
  busyUntil = now + 600 + text.length * 70
  speechSynthesis.speak(u)
}

/** Hausa greetings / phrases worth speaking when they open a line. */
const HAUSA = /^(ina kwana\??|ina wuni\??|ina gajiya\??|barka da (safiya|rana|yamma|zuwa|sallah)!?|sannu da (aiki|zuwa)!?|sannu!?|lafiya lau!?|yauwa!?|to madalla!?|nagode!?|na gode!?|assalamu alaikum!?|kai!?)/i
export function hausaOpening(line: string): string | null {
  const m = line.trim().match(HAUSA)
  return m ? m[0] : null
}

export const MARKET_CALLS = [
  'Ga shi! Ga shi!',
  'Lemu! Lemu mai zaki!',
  'Ruwa sanyi! Pure water!',
  'Doya! Fresh yam!',
  'Customer, come and buy!',
  'Tumatur! Tattasai!',
  'Na rage maka!',
  'Gyada! Gyada!',
  'Suya dey hot o!',
  'Kai, zo nan!'
]
