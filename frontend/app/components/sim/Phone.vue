<script setup lang="ts">
const editLook = useState<boolean>('kk_edit_look', () => false)
// Phone - the in-game smartphone ("KadunaOS"). Home: the time, your money
// and where you are in the story, apps grouped by what they're for, and a
// dock with the four you open most. Apps run full-screen inside the phone
// with one app bar; a few hand off to the game's panels (map, jobs, bag).
import { useClock, formatHour } from '~/composables/useTimeOfDay'
import { useMapOpen, fireKkEvent } from '~/composables/useControlsState'
import { getQuality, setQuality } from '~/utils/quality'
import { voicesOn, setVoicesOn } from '~/utils/voice'
import { useSimStore } from '~/stores/sim'
import { useStoryStore } from '~/stores/story'
import { fmtKsats } from '~/utils/format'

const open = useState<boolean>('kk_phone_open', () => false)
const askOpen = useState<boolean>('kk_ask_open', () => false)
const workOpen = useState<boolean>('kk_work_open', () => false)
const ui = useUiStore()
const sim = useSimStore()
const story = useStoryStore()
const player = usePlayerStore()
const mapOpen = useMapOpen()
const hour = useClock()
const day = useState<number>('kk_day', () => 1)
const quality = ref<'high' | 'low'>('high')
const voices = ref(true)
onMounted(() => ((quality.value = getQuality()), (voices.value = voicesOn())))

type Page =
  | 'home' | 'settings' | 'wallet' | 'shops' | 'school' | 'life' | 'social' | 'connect' | 'games' | 'races' | 'arcade'
  | 'travel' | 'town' | 'family' | 'business' | 'ward' | 'crews'
const page = ref<Page>('home')
/** a store to open straight away in Shops (walked up to one in the city) */
const storeOwner = useState<string | null>('kk_phone_store', () => null)

interface App { id: string; icon: string; label: string; tint: string; page?: Page; run?: () => void }
function go(fn: () => void) {
  open.value = false
  fn()
}
const A: Record<string, App> = {
  wallet: { id: 'wallet', icon: '⚡', label: 'Wallet', tint: 'from-emerald-400 to-teal-600', page: 'wallet' },
  shops: { id: 'shops', icon: '🛍️', label: 'Shops', tint: 'from-pink-400 to-rose-600', page: 'shops' },
  business: { id: 'business', icon: '🏪', label: 'Business', tint: 'from-amber-400 to-orange-600', page: 'business' },
  work: { id: 'work', icon: '💼', label: 'Work', tint: 'from-sky-500 to-indigo-600', run: () => go(() => (workOpen.value = true)) },
  jobs: { id: 'jobs', icon: '📦', label: 'Deliveries', tint: 'from-teal-400 to-cyan-600', run: () => go(() => ui.open('jobs')) },
  life: { id: 'life', icon: '🏡', label: 'Life', tint: 'from-orange-300 to-rose-500', page: 'life' },
  school: { id: 'school', icon: '🎓', label: 'School', tint: 'from-violet-400 to-indigo-600', page: 'school' },
  family: { id: 'family', icon: '👪', label: 'Family', tint: 'from-rose-300 to-red-500', page: 'family' },
  me: { id: 'me', icon: '🙂', label: 'Needs', tint: 'from-rose-300 to-pink-500', run: () => go(() => document.querySelector<HTMLElement>('[data-tour=needs]')?.click()) },
  bag: { id: 'bag', icon: '🎒', label: 'Bag', tint: 'from-amber-300 to-orange-500', run: () => go(() => ui.open('inventory')) },
  social: { id: 'social', icon: '💬', label: 'Chats', tint: 'from-sky-400 to-blue-600', page: 'social' },
  connect: { id: 'connect', icon: '💘', label: 'Connect', tint: 'from-pink-400 to-fuchsia-600', page: 'connect' },
  crews: { id: 'crews', icon: '🏴', label: 'Crews', tint: 'from-zinc-500 to-zinc-800', page: 'crews' },
  ward: { id: 'ward', icon: '🏛️', label: 'Ward', tint: 'from-emerald-300 to-teal-600', page: 'ward' },
  games: { id: 'games', icon: '🎲', label: 'Games', tint: 'from-lime-400 to-emerald-600', page: 'games' },
  arcade: { id: 'arcade', icon: '👾', label: 'Arcade', tint: 'from-fuchsia-500 to-indigo-700', page: 'arcade' },
  races: { id: 'races', icon: '🏁', label: 'Races', tint: 'from-red-400 to-rose-700', page: 'races' },
  map: { id: 'map', icon: '🗺️', label: 'Map', tint: 'from-sky-400 to-blue-600', run: () => go(() => (mapOpen.value = true)) },
  travel: { id: 'travel', icon: '🚕', label: 'Travel', tint: 'from-lime-300 to-green-600', page: 'travel' },
  home: { id: 'home', icon: '🏠', label: 'Ride home', tint: 'from-yellow-300 to-amber-500', run: () => go(() => window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'home' } }))) },
  town: { id: 'town', icon: '🎪', label: 'What’s on', tint: 'from-yellow-300 to-orange-500', page: 'town' },
  weather: { id: 'weather', icon: '⛅', label: 'Weather', tint: 'from-cyan-300 to-sky-500', run: () => fireKkEvent('kk-weather') },
  ask: { id: 'ask', icon: '✨', label: 'Ask', tint: 'from-fuchsia-400 to-violet-600', run: () => go(() => (askOpen.value = true)) },
  settings: { id: 'settings', icon: '⚙️', label: 'Settings', tint: 'from-slate-400 to-slate-600', page: 'settings' }
}
const SECTIONS: Array<{ title: string; apps: string[] }> = [
  { title: 'Money', apps: ['shops', 'business', 'work', 'jobs'] },
  { title: 'Life', apps: ['life', 'school', 'family', 'me', 'bag'] },
  { title: 'People', apps: ['connect', 'crews', 'ward'] },
  { title: 'Play', apps: ['arcade', 'races'] },
  { title: 'City', apps: ['travel', 'home', 'town', 'weather', 'ask', 'settings'] }
]
const DOCK = ['wallet', 'social', 'map', 'games']
const TITLES: Partial<Record<Page, string>> = {
  wallet: 'Wallet', shops: 'Shops', school: 'School', life: 'Life', social: 'Chats', connect: 'Connect', games: 'Games', races: 'Races',
  arcade: 'Arcade', travel: 'Travel', town: 'What’s on', family: 'Family & Health', business: 'Business', ward: 'Ward', crews: 'Crews', settings: 'Settings'
}
function launch(id: string) {
  const a = A[id]
  if (!a) return
  if (a.page) page.value = a.page
  else a.run?.()
}

const night = computed(() => hour.value < 6 || hour.value >= 19)
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dateLine = computed(() => `${DAYS[(day.value - 1) % 7]} · Day ${day.value} · Kaduna`)
const clock = computed(() => formatHour(hour.value).replace(/\s?[AP]M/i, ''))
const ampm = computed(() => (/PM/i.test(formatHour(hour.value)) ? 'PM' : /AM/i.test(formatHour(hour.value)) ? 'AM' : ''))

const goto = useState<string | null>('kk_phone_goto', () => null)
// one watcher for both: "open the phone on app X" sets them in the same
// tick, and two watchers could undo each other
watch([open, goto], ([o, g]: [boolean, string | null], [wasOpen]: [boolean, string | null]) => {
  if (!o) return
  if (g) {
    page.value = g as Page
    goto.value = null
  } else if (!wasOpen) page.value = 'home'
  if (!wasOpen && !story.s) story.refresh()
})
watch(page, (p: Page) => p !== 'shops' && (storeOwner.value = null))
</script>

<template>
  <transition enter-active-class="transition duration-300 ease-out" enter-from-class="translate-y-full opacity-0" leave-active-class="transition duration-200" leave-to-class="translate-y-full opacity-0">
    <div v-if="open" class="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/30 p-3 backdrop-blur-[2px] sm:items-center" @click.self="open = false">
      <div class="relative">
        <button class="absolute -top-12 right-0 rounded-full bg-white px-4 py-2 text-sm font-bold text-ink shadow-lg" @click="open = false">✕ Close</button>
        <!-- device -->
        <div class="h-[min(680px,86dvh)] w-[min(340px,90vw)] rounded-[3rem] bg-[#0d0d0f] p-[9px] shadow-2xl ring-1 ring-white/10">
          <div class="relative flex h-full flex-col overflow-hidden rounded-[2.5rem]" :class="page === 'home' ? 'text-white' : 'bg-[#f5f4f0] text-ink'">
            <!-- wallpaper -->
            <div v-if="page === 'home'" class="absolute inset-0 -z-0 bg-gradient-to-b" :class="night ? 'from-[#0f172a] via-[#312e81] to-[#831843]' : 'from-[#0e7c66] via-[#2a9d8f] to-[#e9c46a]'" />
            <div v-if="page === 'home'" class="pointer-events-none absolute inset-0 opacity-25 [background:radial-gradient(circle_at_20%_10%,white,transparent_35%),radial-gradient(circle_at_90%_70%,white,transparent_30%)]" />

            <!-- status bar -->
            <div class="relative z-10 flex items-center justify-between px-7 pt-3 text-[11px] font-bold" :class="page === 'home' ? '' : 'text-ink'">
              <span class="tabular-nums">{{ formatHour(hour) }}</span>
              <span class="h-[22px] w-[88px] rounded-full bg-black" />
              <span class="tracking-tight">KD 4G ▮▮▮</span>
            </div>

            <!-- ============ home ============ -->
            <template v-if="page === 'home'">
              <div class="relative z-10 px-6 pt-5">
                <div class="flex items-end gap-1.5">
                  <span class="font-display text-[3.4rem] font-semibold leading-none tabular-nums">{{ clock }}</span>
                  <span class="pb-1.5 text-sm font-bold text-white/80">{{ ampm }}</span>
                </div>
                <div class="mt-1 text-[13px] font-semibold text-white/80">{{ dateLine }}</div>
              </div>
              <!-- widgets -->
              <div class="relative z-10 mt-4 grid grid-cols-2 gap-2.5 px-5">
                <button class="rounded-3xl bg-white/15 p-3 text-left backdrop-blur-md hover:bg-white/25" @click="page = 'wallet'">
                  <div class="text-[10px] font-bold uppercase tracking-widest text-white/70">⚡ Wallet</div>
                  <div class="mt-1 truncate font-display text-base font-semibold tabular-nums">{{ player.profile ? fmtKsats(player.profile.ksats_balance) : '-' }}</div>
                  <div class="text-[10px] text-white/70">Send · Add · History</div>
                </button>
                <button class="rounded-3xl bg-white/15 p-3 text-left backdrop-blur-md hover:bg-white/25" @click="open = false">
                  <div class="text-[10px] font-bold uppercase tracking-widest text-white/70">📖 Story</div>
                  <div class="mt-1 line-clamp-2 text-[13px] font-semibold leading-tight">{{ story.s ? (story.s.done ? 'Kaduna is yours' : story.s.title) : '…' }}</div>
                  <div class="text-[10px] text-white/70">{{ story.s && !story.s.done ? `Chapter ${story.s.chapter + 1} of ${story.s.total}` : '' }}</div>
                </button>
              </div>
              <!-- apps -->
              <div class="kk-scroll relative z-10 mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
                <div v-for="s in SECTIONS" :key="s.title">
                  <div class="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-white/60">{{ s.title }}</div>
                  <div class="grid grid-cols-4 gap-x-2 gap-y-2.5">
                    <button v-for="id in s.apps" :key="id" class="flex flex-col items-center gap-1" @click="launch(id)">
                      <span class="flex h-[3.1rem] w-[3.1rem] items-center justify-center rounded-[1.05rem] bg-gradient-to-br text-[1.55rem] shadow-md shadow-black/20 ring-1 ring-white/20" :class="A[id]!.tint">{{ A[id]!.icon }}</span>
                      <span class="w-full truncate text-center text-[10.5px] font-semibold text-white/95">{{ A[id]!.label }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <!-- dock -->
              <div class="relative z-10 mx-3 mb-5 grid grid-cols-4 gap-2 rounded-[1.8rem] bg-white/20 px-3 py-2.5 backdrop-blur-xl">
                <button v-for="id in DOCK" :key="id" class="flex flex-col items-center" :title="A[id]!.label" @click="launch(id)">
                  <span class="flex h-[3.1rem] w-[3.1rem] items-center justify-center rounded-[1.05rem] bg-gradient-to-br text-[1.55rem] shadow-md ring-1 ring-white/20" :class="A[id]!.tint">{{ A[id]!.icon }}</span>
                </button>
              </div>
            </template>

            <!-- ============ an app ============ -->
            <template v-else>
              <div class="flex items-center gap-2 px-4 pb-2 pt-3">
                <button class="flex h-8 items-center rounded-full px-1.5 text-[15px] font-semibold text-kadeep" @click="page = 'home'">‹ Home</button>
                <div class="flex-1 text-center font-display text-[17px] font-semibold">{{ TITLES[page as Page] }}</div>
                <span class="w-[4.2rem]" />
              </div>
              <div class="kk-scroll min-h-0 flex-1 overflow-y-auto px-3.5 pb-8">
                <PhoneWallet v-if="page === 'wallet'" />
                <PhoneShops v-else-if="page === 'shops'" :owner="storeOwner" />
                <PhoneSchool v-else-if="page === 'school'" />
                <PhoneLife v-else-if="page === 'life'" />
                <PhoneSocial v-else-if="page === 'social'" tab="contacts" />
                <PhoneSocial v-else-if="page === 'connect'" tab="connect" />
                <PhoneGames v-else-if="page === 'games'" />
                <PhoneRaces v-else-if="page === 'races'" @close="open = false" />
                <PhoneArcade v-else-if="page === 'arcade'" />
                <PhoneTravel v-else-if="page === 'travel'" />
                <PhoneTown v-else-if="page === 'town'" />
                <PhoneFamily v-else-if="page === 'family'" />
                <PhoneBusiness v-else-if="page === 'business'" />
                <PhoneWard v-else-if="page === 'ward'" />
                <PhoneCrews v-else-if="page === 'crews'" />
                <div v-else-if="page === 'settings'" class="space-y-2">
                  <div class="divide-y divide-ink/5 overflow-hidden rounded-2xl bg-white">
                    <div class="flex items-center justify-between px-3 py-2.5 text-sm font-semibold">Sound <AudioSystem /></div>
                    <button class="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold hover:bg-ink/5" @click="(voices = !voices), setVoicesOn(voices)">
                      Voices (greetings, market calls) <span class="kk-chip">{{ voices ? 'On' : 'Off' }}</span>
                    </button>
                    <button class="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold hover:bg-ink/5" @click="setQuality(quality === 'low' ? 'high' : 'low')">
                      Graphics <span class="kk-chip">{{ quality === 'low' ? '⚡ Lite' : '✨ HD' }}</span>
                    </button>
                  </div>
                  <div class="divide-y divide-ink/5 overflow-hidden rounded-2xl bg-white">
                    <button class="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold hover:bg-ink/5" @click="(editLook = true), (open = false)">Change my look <span class="text-ink/30">›</span></button>
                    <NuxtLink to="/arcade" class="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold hover:bg-ink/5">Arcade (full screen) <span class="text-ink/30">›</span></NuxtLink>
                    <button class="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold hover:bg-ink/5" @click="(sim.tourDone = false), sim.save(), (open = false)">Replay the tour <span class="text-ink/30">›</span></button>
                  </div>
                  <div class="overflow-hidden rounded-2xl bg-white">
                    <button class="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50" @click="sim.reset(), (open = false)">Create a new Sim <span>›</span></button>
                  </div>
                </div>
              </div>
            </template>
            <div class="absolute bottom-2 left-1/2 z-10 h-1 w-28 -translate-x-1/2 rounded-full" :class="page === 'home' ? 'bg-white/70' : 'bg-ink/30'" />
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
