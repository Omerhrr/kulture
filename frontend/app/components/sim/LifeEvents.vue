<script setup lang="ts">
// LifeEvents - the city's calendar and daily texture, plus the social-event
// minigames:
//  * calendar chip: Day N · weekday, and what's on (market day, Jumu'ah,
//    Sunday service, Sallah / Christmas festivals, wedding invites)
//  * NEPA: the power goes off now and then; generators kick in at night
//  * harmattan mornings, keke/okada riders calling for passengers
//  * context actions: dance battle (bar), talent show (cinema), 5-a-side
//    (park), landmark info cards + the Kajuru Castle weekend trip
import { fmtKsats } from '~/utils/format'
import { useClock } from '~/composables/useTimeOfDay'
import { useInterior, usePlayerPose, useRide } from '~/composables/useControlsState'
import { inPark } from '~/utils/parksShared'
import { LANDMARK_INFO, TOWN_INFO_KEYS } from '~/utils/landmarkInfo'
import { setWeather, weather } from '~/utils/weather'
import { kkAudio } from '~/utils/audio'
import { REGION_ID, regionById, IN_KADUNA } from '~/utils/regions'
import { BAKE } from '~/utils/kaduna'
import { makeChart, tap, expire, rivalScore as rivalPts, songEnd, markerAt, judgeHit, type Note } from '~/utils/rhythm'
import { weekdayOf, type SceneState } from '~/utils/lifeShared'

const ui = useUiStore()
const api = useGameApi()
const hour = useClock()
const day = useState<number>('kk_day', () => 1)
const nepa = useState<{ off: boolean; since: number }>('kk_nepa', () => ({ off: false, since: 0 }))
const interior = useInterior()
const ride = useRide()
const pose = usePlayerPose()
const playerPos = useState<[number, number, number]>('kk_player_pos')
const landmark = useState<{ key: string; x: number; z: number } | null>('kk_landmark_near', () => null)
const scene = useState<SceneState>('kk_scene_social', () => ({ date: null, owambe: null, dance: null, football: null }))

// ------------------------------------------------------------ calendar
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const weekday = computed(() => weekdayOf(day.value))
const festival = computed(() => (day.value % 20 === 9 ? 'sallah' : day.value % 20 === 19 ? 'christmas' : null))
const today = computed(() => {
  const w = weekday.value
  const out: string[] = []
  if (festival.value === 'sallah') out.push('🌙 Sallah - durbar & celebrations at Murtala Square')
  if (festival.value === 'christmas') out.push('🎄 Christmas - carols and lights at Murtala Square')
  if (w === 0 || w === 3) out.push('🧺 Market day at Central Market')
  if (w === 4) out.push('🕌 Jumu’ah prayers 1-2 pm')
  if (w === 6) out.push('⛪ Sunday service 8-11 am')
  if (w === 5) out.push('💒 Wedding season - owambe invites')
  return out
})
const calOpen = ref(false)
const wedding = ref<{ couple: string } | null>(null)
// strangers' weddings: never a name the story or the dating app uses
const COUPLES = ['Hauwa & Yusuf', 'Adaeze & Chinedu', 'Hadiza & Kabiru', 'Ramatu & Idris', 'Yemisi & Uche']
let lastHourInt = -1
watch(hour, (h) => {
  const hi = Math.floor(h)
  if (hi === lastHourInt) return
  lastHourInt = hi
  // announcements on the hour
  if (hi === 7) {
    for (const t of today.value) ui.showToast(t, 'info')
    // harmattan mornings: every few days the dusty haze rolls in
    if (day.value % 4 === 2 && weather.kind !== 'harmattan') {
      setWeather('harmattan')
      ui.showToast('🌫️ Harmattan this morning - dusty, dry and cool.', 'info')
    }
  }
  if (hi === 13 && weather.kind === 'harmattan') setWeather('sunny')
  if (weekday.value === 5 && hi === 15 && !wedding.value) wedding.value = { couple: COUPLES[day.value % COUPLES.length]! }
  if (hi === 21) wedding.value = null
  // NEPA: lights go and come back
  if (!nepa.value.off && Math.random() < 0.16) {
    nepa.value = { off: true, since: h }
    ui.showToast(hi >= 18 || hi < 6 ? '⚡ NEPA has taken light! Generators are kicking in…' : '⚡ NEPA has taken light.', 'info')
  } else if (nepa.value.off && ((h - nepa.value.since + 24) % 24 > 1.5) && Math.random() < 0.6) {
    nepa.value = { off: false, since: h }
    ui.showToast('💡 Up NEPA! Light is back.', 'success')
  }
})
watch(
  () => nepa.value.off && (hour.value >= 18 || hour.value < 6 || interior.value.inside),
  (gen) => kkAudio.setGenerator(gen)
)
function attendWedding() {
  const c = wedding.value
  wedding.value = null
  if (!c) return
  window.dispatchEvent(new CustomEvent('kk-owambe', { detail: { partner: c.couple, guest: true, female: true } }))
}

// ------------------------------------------------------------ keke / okada calls
const call = ref<string | null>(null)
const CALLS = ['Keke! Kawo, Kawo! 20,000 ks!', 'Okada! Where you dey go? Ungwan Rimi, Barnawa!', 'Kasuwa! Central Market, enter enter!', 'Sabon Tasha! One chance remain!', 'Malali, Malali! Keke dey go now!', 'Oga, you dey go Kakuri? Make I carry you.', 'Hajiya, Kawo? Enter, 15,000 ks only!']
let callTimer: any = null
onMounted(() => {
  callTimer = setInterval(() => {
    if (interior.value.inside || ride.value.active || Math.random() > 0.35) return
    call.value = CALLS[Math.floor(Math.random() * CALLS.length)]!
    kkAudio.talkBlip?.()
    setTimeout(() => (call.value = null), 3600)
  }, 14000)
})
onBeforeUnmount(() => clearInterval(callTimer))

// ------------------------------------------------------------ context actions
const where = computed(() => {
  if (interior.value.inside) return interior.value.venue ?? null
  return inPark(playerPos.value[0], playerPos.value[2], 10) ? 'park' : null
})
const mini = ref<null | 'dance' | 'talent'>(null)

// ---- dance battle: hit the arrows on the beat
const ARROWS = ['⬅️', '⬆️', '⬇️', '➡️']
const KEYS = ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight']
const notes = ref<Note[]>([])
const t0 = ref(0)
const now = ref(0)
const myScore = ref(0)
const rivalScore = ref(0)
const result = ref<string | null>(null)
let raf = 0
function startDance() {
  mini.value = 'dance'
  result.value = null
  myScore.value = 0
  rivalScore.value = 0
  notes.value = makeChart()
  t0.value = performance.now()
  window.dispatchEvent(new CustomEvent('kk-dance-battle', { detail: { active: true, rival: 'DJ Kabiru' } }))
  const loop = () => {
    now.value = performance.now() - t0.value
    expire(notes.value, now.value)
    rivalScore.value = rivalPts(notes.value, now.value)
    if (now.value > songEnd(notes.value)) return finishDance()
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
}
function hitLane(lane: number) {
  if (mini.value !== 'dance' || result.value) return
  myScore.value = Math.max(0, myScore.value + tap(notes.value, lane, now.value))
}
async function finishDance() {
  cancelAnimationFrame(raf)
  const won = myScore.value > rivalScore.value
  result.value = won ? 'The crowd goes wild - you win the dance battle!' : 'DJ Kabiru takes it this time.'
  const r = await api.apiPost<any>('/life/event', { event: 'dance_battle', won }).catch(() => null)
  if (r?.prize) result.value += ` Prize ${fmtKsats(r.prize)}.`
}
function onKey(e: KeyboardEvent) {
  const i = KEYS.indexOf(e.key)
  if (i >= 0 && mini.value === 'dance') {
    e.preventDefault()
    hitLane(i)
  }
  if (e.code === 'Space' && mini.value === 'talent') {
    e.preventDefault()
    talentHit()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
})

// ---- talent show: pick an act, nail three timing bars, judges score you
const ACTS = [
  { id: 'sing', label: '🎤 Sing', pose: 'worship' },
  { id: 'comedy', label: '😂 Stand-up comedy', pose: 'talk' },
  { id: 'dance', label: '💃 Dance', pose: 'dance' }
]
const act = ref<string | null>(null)
const bars = ref<number[]>([])
const barPos = ref(0)
const rivals = ref<Array<{ name: string; score: number }>>([])
function startTalent(a: (typeof ACTS)[number]) {
  act.value = a.id
  pose.value = a.pose
  bars.value = []
  result.value = null
  rivals.value = [
    { name: 'Lantana (singer)', score: 60 + Math.round(Math.random() * 25) },
    { name: 'Mr Funny Kaduna', score: 55 + Math.round(Math.random() * 30) },
    { name: 'Sani the Juggler', score: 50 + Math.round(Math.random() * 30) }
  ]
  const s = performance.now()
  const loop = () => {
    barPos.value = markerAt(performance.now() - s, bars.value.length)
    if (bars.value.length < 3) raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
}
async function talentHit() {
  if (!act.value || bars.value.length >= 3) return
  bars.value.push(judgeHit(barPos.value))
  if (bars.value.length < 3) return
  const score = Math.round(bars.value.reduce((a, b) => a + b, 0) / 3)
  const best = Math.max(...rivals.value.map((r) => r.score))
  const won = score > best
  result.value = `Judges' score: ${score}. ${won ? 'You win the talent show! 🏆' : `${rivals.value.find((r) => r.score === best)!.name} wins with ${best}.`}`
  const r = await api.apiPost<any>('/life/event', { event: 'talent_show', won }).catch(() => null)
  if (r?.prize) result.value += ` Prize ${fmtKsats(r.prize)}.`
}
function closeMini() {
  cancelAnimationFrame(raf)
  if (mini.value === 'dance') window.dispatchEvent(new CustomEvent('kk-dance-battle', { detail: { active: false } }))
  if (mini.value === 'talent' && pose.value) pose.value = null
  mini.value = null
  act.value = null
}

// football result → prize
watch(
  () => scene.value.football,
  async (fb, old) => {
    if (!fb && old) {
      const won = old.score[0] > old.score[1]
      if (won) {
        const r = await api.apiPost<any>('/life/event', { event: 'football', won }).catch(() => null)
        if (r?.prize) ui.showToast(`Match prize ${fmtKsats(r.prize)} ⚽`, 'success')
      }
    }
  }
)

// ---- player-owned businesses: buy something, the owner earns
const biz = useState<null | { owner_id: string; owner: string; name: string; kind: string }>('kk_biz_near', () => null)
const buying = ref(false)
async function buyAtBiz() {
  const b = biz.value
  if (!b || buying.value) return
  buying.value = true
  try {
    const r = await api.apiPost<any>('/venues/spend', { service: b.kind === 'restaurant' ? 'restaurant_meal' : 'shop_groceries', business_owner: b.owner_id })
    ui.showToast(`${b.kind === 'restaurant' ? 'Enjoyed a plate' : 'Bought groceries'} at ${b.name} · ${fmtKsats(r.price_ksats)}`, 'success')
  } catch (e: any) {
    ui.showToast(e.message || 'Could not buy', 'error')
  } finally {
    buying.value = false
  }
}
// walk in: the store's shelves open on your phone (Shops)
const phoneOpen = useState<boolean>('kk_phone_open', () => false)
const phoneGoto = useState<string | null>('kk_phone_goto', () => null)
const phoneStore = useState<string | null>('kk_phone_store', () => null)
function browseBiz() {
  if (!biz.value) return
  phoneStore.value = biz.value.owner_id
  phoneGoto.value = 'shops'
  phoneOpen.value = true
}
const townName = regionById(REGION_ID).name
const fire = (name: string) => window.dispatchEvent(new CustomEvent(name))

// ---- landmark info + Kajuru trip
const KIND_TEXT: Record<string, string> = {
  market: 'Busy from dawn: grains, pepper, cloth, phones and everything in between.',
  mosque: 'On Fridays the Jumu’ah crowd fills the courtyard and the street outside.',
  cathedral: 'Sunday mornings the choir can be heard from the road.',
  hospital: 'The town’s main hospital.',
  campus: 'Students, lecture halls and the busy campus gate.',
  station: 'Trains on the old colonial line still call here.',
  junction: 'Where the railway lines meet.',
  motorpark: 'Shared taxis and buses to every town in Kaduna State (Phone → Travel).',
  govhouse: 'A seat of traditional or local government.',
  stadium: 'Local league football and big events.',
  park: 'Families relax here in the evenings.',
  square: 'The town square: rallies, durbars and celebrations.'
}
const info = computed(() => {
  const k = landmark.value?.key
  if (!k) return null
  const town = TOWN_INFO_KEYS.has(k) || IN_KADUNA ? LANDMARK_INFO[k] : null
  if (town) return town
  const l = BAKE.landmarks.find((x) => x.key === k)
  return l ? { name: l.name, text: KIND_TEXT[l.kind] ?? `${l.name}, ${regionById(REGION_ID).name}.` } : null
})
const infoHidden = ref<string | null>(null)
function kajuruTrip() {
  const lm = (window as any).__kk_landmarks?.()?.find((b: any) => b.key === 'kajuru_castle')
  if (!lm) return
  const w = weekday.value
  ui.showToast(w >= 5 ? 'Weekend trip to Kajuru Castle - enjoy the view from the rocks!' : 'Kajuru is best at the weekend, but off we go!', 'info')
  window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'place', place: { name: 'Kajuru Castle', to: [lm.x, lm.z + 26] } } }))
}
if (import.meta.dev && typeof window !== 'undefined') {
  ;(window as any).__kk_life = () => ({ day: day.value, weekday: DAYS[weekday.value], today: today.value, nepa: nepa.value, where: where.value, landmark: landmark.value?.key })
  ;(window as any).__kk_setday = (d: number) => (day.value = d)
  ;(window as any).__kk_nepa = (off: boolean) => (nepa.value = { off, since: hour.value })
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[35]">
    <!-- calendar chip -->
    <div class="pointer-events-auto absolute right-3 top-[3.6rem] flex flex-col items-end gap-1">
      <button class="rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-ink shadow" @click="calOpen = !calOpen">
        📅 What's on · {{ townName }}<span v-if="nepa.off" class="ml-1 text-amber-600">· ⚡ NEPA off</span>
      </button>
      <div v-if="calOpen" class="w-56 rounded-2xl bg-white/95 p-3 text-[11px] text-ink shadow-lg">
        <div class="mb-1 font-bold">{{ DAYS[weekday] }}</div>
        <div v-for="t in today" :key="t">{{ t }}</div>
        <div v-if="!today.length" class="text-ink/50">A normal day in Kaduna.</div>
      </div>
    </div>

    <!-- keke / okada call -->
    <transition enter-active-class="transition duration-300" enter-from-class="opacity-0 -translate-x-4" leave-active-class="transition duration-300" leave-to-class="opacity-0">
      <div v-if="call" class="absolute bottom-40 left-3 max-w-[220px] rounded-2xl rounded-bl-none bg-yellow-300 px-3 py-2 text-xs font-bold text-ink shadow-lg">🛺 {{ call }}</div>
    </transition>

    <!-- wedding invite -->
    <div v-if="wedding" class="pointer-events-auto absolute right-3 top-[6rem] w-60 rounded-2xl bg-white p-3 text-ink shadow-xl">
      <div class="text-xs font-bold">💌 You're invited!</div>
      <div class="text-[11px] text-ink/60">{{ wedding.couple }} are getting married. Owambe this evening - come and spray money.</div>
      <div class="mt-2 flex gap-1">
        <button class="flex-1 rounded-full bg-emerald-600 py-1 text-[11px] font-bold text-white" @click="attendWedding">Attend</button>
        <button class="rounded-full bg-ink/10 px-3 py-1 text-[11px] font-bold" @click="wedding = null">Later</button>
      </div>
    </div>

    <!-- context actions -->
    <div v-if="!mini && !scene.football" class="pointer-events-auto absolute bottom-28 left-1/2 flex -translate-x-1/2 gap-2">
      <template v-if="biz">
        <button class="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-lg" @click="browseBiz">🛍️ Browse {{ biz.name }} <span class="text-[10px] opacity-75">({{ biz.owner }}'s)</span></button>
        <button v-if="biz.kind === 'restaurant'" class="rounded-full bg-orange-600 px-4 py-2 text-sm font-bold text-white shadow-lg" :disabled="buying" @click="buyAtBiz">🍲 Eat a plate</button>
      </template>
      <button v-if="where === 'bar'" class="rounded-full bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white shadow-lg" @click="startDance">🕺 Dance battle</button>
      <button v-if="where === 'cinema'" class="rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-lg" @click="mini = 'talent'">🎤 Talent show</button>
      <button v-if="where === 'park'" class="rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg" @click="fire('kk-football')">⚽ 5-a-side</button>
    </div>
    <div v-if="scene.football" class="pointer-events-auto absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink/85 px-4 py-2 text-sm font-bold text-white">
      <span class="text-emerald-400">You {{ scene.football.score[0] }}</span> - <span class="text-rose-400">{{ scene.football.score[1] }} Them</span>
      <button class="rounded-full bg-white/20 px-2 text-xs" @click="fire('kk-football-end')">Leave</button>
    </div>

    <!-- landmark info -->
    <div v-if="info && infoHidden !== landmark?.key && !mini" class="pointer-events-auto absolute right-3 top-[14rem] w-64 rounded-2xl bg-white/95 p-3 text-ink shadow-xl">
      <div class="flex items-start justify-between">
        <div class="text-sm font-bold">📍 {{ info.name }}</div>
        <button class="text-xs text-ink/40" @click="infoHidden = landmark?.key ?? null">✕</button>
      </div>
      <div class="mt-1 text-[11px] leading-relaxed text-ink/70">{{ info.text }}</div>
      <NuxtLink v-if="landmark?.key === 'kajuru_castle'" to="/kajuru" class="mt-2 block rounded-full bg-[#8c5a3c] py-1.5 text-center text-[11px] font-bold text-white">🏰 Explore the castle</NuxtLink>
    </div>
    <div v-if="landmark?.key === 'kajuru_castle' || (calOpen && weekday >= 5)" class="pointer-events-auto absolute right-3 top-[20rem]">
      <button v-if="landmark?.key !== 'kajuru_castle'" class="rounded-full bg-[#8c5a3c] px-3 py-1.5 text-[11px] font-bold text-white shadow" @click="kajuruTrip">🏰 Weekend trip: Kajuru Castle</button>
    </div>

    <!-- minigames -->
    <div v-if="mini" class="pointer-events-auto absolute inset-x-0 bottom-6 mx-auto w-[min(420px,94vw)] rounded-3xl bg-ink/90 p-4 text-white shadow-2xl">
      <div class="mb-2 flex items-center justify-between text-sm font-bold">
        <span>{{ mini === 'dance' ? '🕺 Dance battle vs DJ Kabiru' : '🎤 Talent show' }}</span>
        <button class="rounded-full bg-white/15 px-2 text-xs" @click="closeMini">Close</button>
      </div>
      <template v-if="mini === 'dance'">
        <div class="mb-1 flex justify-between text-xs"><span>You {{ myScore }}</span><span>Rival {{ rivalScore }}</span></div>
        <div class="relative grid h-48 grid-cols-4 overflow-hidden rounded-2xl bg-white/5">
          <div v-for="l in 4" :key="l" class="relative border-r border-white/10 last:border-0" />
          <div class="absolute inset-x-0 bottom-6 h-0.5 bg-amber-300/70" />
          <template v-for="(n, i) in notes" :key="i">
            <div v-if="n.hit === null && n.t - now < 1800 && n.t - now > -260" class="absolute text-2xl" :style="{ left: `${n.lane * 25 + 6}%`, bottom: `${24 + ((n.t - now) / 1800) * 160}px` }">{{ ARROWS[n.lane] }}</div>
          </template>
        </div>
        <div class="mt-2 grid grid-cols-4 gap-1">
          <button v-for="(a, i) in ARROWS" :key="i" class="rounded-xl bg-white/15 py-2 text-xl active:bg-amber-400" @pointerdown.prevent="hitLane(i)">{{ a }}</button>
        </div>
        <div v-if="result" class="mt-2 text-sm font-bold text-amber-300">{{ result }}</div>
      </template>
      <template v-else>
        <div v-if="!act" class="space-y-1">
          <div class="text-xs text-white/70">Pick your act. Tap / Space when the marker is in the gold zone - three times.</div>
          <button v-for="a in ACTS" :key="a.id" class="block w-full rounded-xl bg-white/15 py-2 text-sm font-bold" @click="startTalent(a)">{{ a.label }}</button>
        </div>
        <div v-else>
          <div class="relative my-2 h-6 rounded-full bg-white/10">
            <div class="absolute inset-y-0 left-[40%] w-[20%] rounded-full bg-amber-400/50" />
            <div class="absolute top-0 h-6 w-1.5 rounded bg-white" :style="{ left: `${barPos * 100}%` }" />
          </div>
          <div class="flex gap-2 text-xs"><span v-for="(b, i) in bars" :key="i" class="rounded-full bg-white/15 px-2">{{ b }}</span></div>
          <button v-if="bars.length < 3" class="mt-2 w-full rounded-full bg-amber-500 py-2 text-sm font-bold" @pointerdown.prevent="talentHit">Perform!</button>
          <div v-if="result" class="mt-2 text-sm font-bold text-amber-300">{{ result }}</div>
        </div>
      </template>
    </div>
  </div>
</template>
