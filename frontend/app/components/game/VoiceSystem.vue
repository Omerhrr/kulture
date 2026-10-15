<script setup lang="ts">
// VoiceSystem - the spoken side of the street:
//  - people say their Hausa greeting aloud when you talk to them
//    ("Ina kwana?", "Sannu da aiki!")
//  - market vendors call out their goods when you walk through a market
//  - the call to prayer at the five prayer times (game clock). The adhan
//    plays from /audio/adhan.mp3 when that recording is installed (a
//    public-domain recording the owner adds); otherwise a soft tone and a
//    notice. It is louder near a mosque and gentle elsewhere.
import { BAKE } from '~/utils/kaduna'
import { say, hausaOpening, MARKET_CALLS, voicesOn } from '~/utils/voice'
import { kkAudio } from '~/utils/audio'
import { useClock } from '~/composables/useTimeOfDay'

const ui = useUiStore()
const hour = useClock()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [0, 0, 0])

// ---- greetings in dialogue
const FEMALE = /^(mama|madam|hajiya|amina|ngozi|halima|aisha|fatima|zainab|hauwa|maryam|blessing|grace|comfort|esther|ruth|hadiza|binta|asabe|ladi|kulu|rakiya|salamatu|jummai|chioma|amaka|funmi)/i
watch(
  () => ui.dialogue?.text,
  (t) => {
    if (!t) return
    const g = hausaOpening(t)
    if (g) say(g, { female: FEMALE.test(ui.dialogue?.npcName ?? ''), priority: true })
  }
)

// ---- market chatter: real voices on top of the audio engine's crowd bed
const markets = BAKE.landmarks.filter((l) => l.kind === 'market' || l.kind === 'motorpark')
let callT = 4
// ---- prayer times (game clock, roughly Kaduna's through the year)
const PRAYERS: Array<[string, number]> = [
  ['Fajr', 5.2],
  ['Zuhr', 13.1],
  ['Asr', 16.4],
  ['Maghrib', 18.6],
  ['Isha', 19.9]
]
const mosques = BAKE.landmarks.filter((l) => l.kind === 'mosque')
let lastHour = hour.value
let adhan: HTMLAudioElement | null = null
let hasAdhan: boolean | null = null
async function adhanReady() {
  if (hasAdhan !== null) return hasAdhan
  try {
    const r = await fetch('/audio/adhan.mp3', { method: 'HEAD' })
    hasAdhan = r.ok && !(r.headers.get('content-type') ?? '').includes('html')
  } catch {
    hasAdhan = false
  }
  return hasAdhan
}
async function callToPrayer(name: string) {
  const [x, , z] = playerPos.value
  const d = mosques.length ? Math.min(...mosques.map((m) => Math.hypot(m.x - x, m.z - z))) : 2000
  const vol = d < 250 ? 0.8 : d < 900 ? 0.45 : 0.22
  ui.showToast(`🕌 ${name} - call to prayer`, 'info')
  if (kkAudio.isMuted) return
  if (await adhanReady()) {
    adhan?.pause()
    adhan = new Audio('/audio/adhan.mp3')
    adhan.volume = vol
    adhan.play().catch(() => {})
  } else kkAudio.chime(true)
}

let timer: any
onMounted(() => {
  timer = setInterval(() => {
    // market calls
    callT -= 1
    if (callT <= 0) {
      callT = 5 + Math.random() * 7
      const [x, , z] = playerPos.value
      const d = markets.length ? Math.min(...markets.map((m) => Math.hypot(m.x - x, m.z - z))) : 9999
      if (d < 110 && voicesOn() && !kkAudio.isMuted && !ui.dialogue) {
        const female = Math.random() < 0.5
        say(MARKET_CALLS[Math.floor(Math.random() * MARKET_CALLS.length)]!, { female, volume: 0.35 + 0.4 * (1 - d / 110), rate: 1.05, pitch: female ? 1.2 + Math.random() * 0.2 : 0.8 + Math.random() * 0.2 })
      }
    }
    // prayer times: fire when the clock crosses one
    const h = hour.value
    for (const [name, at] of PRAYERS) {
      const crossed = lastHour <= h ? lastHour < at && h >= at : lastHour < at || h >= at
      if (crossed && Math.abs(h - lastHour) < 3) callToPrayer(name)
    }
    lastHour = h
  }, 1000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  adhan?.pause()
})
if (import.meta.dev) (window as any).__kk_prayer = (n = 'Asr') => callToPrayer(n)
</script>

<template>
  <span class="hidden" />
</template>
