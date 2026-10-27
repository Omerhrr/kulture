<script setup lang="ts">
const editLook = useState<boolean>('kk_edit_look', () => false)
// Phone - an in-game smartphone. Apps open the existing panels so there is
// one place to find everything (jobs, bag, wallet, map, settings, help).
import { useClock, formatHour } from '~/composables/useTimeOfDay'
import { useMapOpen, fireKkEvent } from '~/composables/useControlsState'
import { getQuality, setQuality } from '~/utils/quality'
import { voicesOn, setVoicesOn } from '~/utils/voice'
import { useSimStore } from '~/stores/sim'

const open = useState<boolean>('kk_phone_open', () => false)
const askOpen = useState<boolean>('kk_ask_open', () => false)
const workOpen = useState<boolean>('kk_work_open', () => false)
const ui = useUiStore()
const sim = useSimStore()
const mapOpen = useMapOpen()
const hour = useClock()
const quality = ref<'high' | 'low'>('high')
const voices = ref(true)
onMounted(() => ((quality.value = getQuality()), (voices.value = voicesOn())))
type Page = 'home' | 'settings' | 'school' | 'life' | 'social' | 'connect' | 'games' | 'races' | 'arcade' | 'travel' | 'town' | 'family' | 'business' | 'ward' | 'crews'
const page = ref<Page>('home')
const TITLES: Record<string, string> = { school: '🎓 School', life: '🏡 Life', social: '👥 Contacts', connect: '💘 Connect', games: '🎮 Games', races: '🏁 Races', arcade: '👾 Arcade', travel: '🚕 Travel', town: '🎪 What’s on', family: '👨‍👩‍👧 Family & Health', business: '🏪 Business', ward: '🏛️ Ward', crews: '🏴 Crews' }
const night = computed(() => hour.value < 6 || hour.value >= 19)

function go(fn: () => void) {
  open.value = false
  fn()
}
const apps = [
  { id: 'work', icon: '💼', label: 'Work', bg: 'from-emerald-400 to-emerald-600', run: () => go(() => (workOpen.value = true)) },
  { id: 'jobs', icon: '📦', label: 'Deliveries', bg: 'from-teal-400 to-cyan-600', run: () => go(() => ui.open('jobs')) },
  { id: 'home', icon: '🚕', label: 'Ride home', bg: 'from-amber-300 to-yellow-500', run: () => go(() => window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'home' } }))) },
  { id: 'bag', icon: '🎒', label: 'Bag', bg: 'from-amber-300 to-orange-500', run: () => go(() => ui.open('inventory')) },
  { id: 'wallet', icon: '⚡', label: 'Wallet', bg: 'from-yellow-300 to-amber-500', run: () => go(() => ui.open('ledger')) },
  { id: 'map', icon: '🗺️', label: 'Maps', bg: 'from-sky-400 to-blue-600', run: () => go(() => (mapOpen.value = true)) },
  { id: 'weather', icon: '⛅', label: 'Weather', bg: 'from-cyan-300 to-sky-500', run: () => fireKkEvent('kk-weather') },
  { id: 'ask', icon: '✨', label: 'Ask', bg: 'from-fuchsia-400 to-violet-600', run: () => go(() => (askOpen.value = true)) },
  { id: 'me', icon: '🙂', label: 'Me', bg: 'from-rose-300 to-pink-500', run: () => go(() => document.querySelector<HTMLElement>('[data-tour=needs]')?.click()) },
  { id: 'school', icon: '🎓', label: 'School', bg: 'from-violet-400 to-indigo-600', run: () => (page.value = 'school') },
  { id: 'life', icon: '🏡', label: 'Life', bg: 'from-orange-300 to-rose-500', run: () => (page.value = 'life') },
  { id: 'social', icon: '👥', label: 'Contacts', bg: 'from-sky-300 to-indigo-500', run: () => (page.value = 'social') },
  { id: 'connect', icon: '💘', label: 'Connect', bg: 'from-pink-400 to-rose-600', run: () => (page.value = 'connect') },
  { id: 'games', icon: '🎮', label: 'Games', bg: 'from-lime-400 to-emerald-600', run: () => (page.value = 'games') },
  { id: 'travel', icon: '🚕', label: 'Travel', bg: 'from-lime-300 to-green-600', run: () => (page.value = 'travel') },
  { id: 'town', icon: '🎪', label: 'What’s on', bg: 'from-yellow-300 to-orange-500', run: () => (page.value = 'town') },
  { id: 'family', icon: '👨‍👩‍👧', label: 'Family', bg: 'from-rose-300 to-red-500', run: () => (page.value = 'family') },
  { id: 'business', icon: '🏪', label: 'Business', bg: 'from-amber-400 to-orange-600', run: () => (page.value = 'business') },
  { id: 'ward', icon: '🏛️', label: 'Ward', bg: 'from-emerald-300 to-teal-600', run: () => (page.value = 'ward') },
  { id: 'crews', icon: '🏴', label: 'Crews', bg: 'from-zinc-500 to-zinc-800', run: () => (page.value = 'crews') },
  { id: 'arcade', icon: '👾', label: 'Arcade', bg: 'from-fuchsia-500 to-indigo-700', run: () => (page.value = 'arcade') },
  { id: 'races', icon: '🏁', label: 'Races', bg: 'from-red-400 to-rose-700', run: () => (page.value = 'races') },
  { id: 'settings', icon: '⚙️', label: 'Settings', bg: 'from-slate-400 to-slate-600', run: () => (page.value = 'settings') }
]
const goto = useState<string | null>('kk_phone_goto', () => null)
watch(open, (o) => {
  if (!o) return
  page.value = (goto.value as Page) || 'home'
  goto.value = null
})
watch(goto, (g) => {
  if (g && open.value) {
    page.value = g as Page
    goto.value = null
  }
})
</script>

<template>
  <transition enter-active-class="transition duration-300 ease-out" enter-from-class="translate-y-full opacity-0" leave-active-class="transition duration-200" leave-to-class="translate-y-full opacity-0">
    <div v-if="open" class="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/30 p-3 backdrop-blur-[2px] sm:items-center" @click.self="open = false">
      <div class="relative">
        <button class="absolute -top-12 right-0 rounded-full bg-white px-4 py-2 text-sm font-bold text-ink shadow-lg" @click="open = false">✕ Close</button>
        <!-- device -->
        <div class="h-[min(640px,82dvh)] w-[min(320px,88vw)] rounded-[2.8rem] bg-[#111] p-2.5 shadow-2xl">
          <div class="relative flex h-full flex-col overflow-hidden rounded-[2.3rem] bg-gradient-to-b text-white" :class="night ? 'from-[#1e1b4b] via-[#4c1d95] to-[#9d174d]' : 'from-[#5b4bff] via-[#a855f7] to-[#fb923c]'">
            <div class="flex items-center justify-between px-6 pt-3 text-xs font-bold">
              <span class="tabular-nums">{{ formatHour(hour) }}</span>
              <span class="h-6 w-24 rounded-full bg-black" />
              <span>●●● 4G</span>
            </div>
            <template v-if="page === 'home'">
              <div class="px-6 pt-6">
                <div class="font-display text-5xl font-semibold tabular-nums leading-none">{{ formatHour(hour).replace(/\s?[AP]M/i, '') }}</div>
                <div class="mt-1 text-sm font-semibold text-white/80">{{ sim.name ? '@' + sim.name : 'Kaduna' }} · Kaduna</div>
              </div>
              <div class="kk-scroll mt-auto grid min-h-0 grid-cols-4 gap-x-3 gap-y-3 overflow-y-auto px-5 pb-8 pt-2">
                <button v-for="a in apps" :key="a.id" class="flex flex-col items-center gap-1.5" @click="a.run()">
                  <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl shadow-lg" :class="a.bg">{{ a.icon }}</span>
                  <span class="text-[11px] font-bold text-white/95">{{ a.label }}</span>
                </button>
              </div>
            </template>
            <template v-else-if="page !== 'settings'">
              <div class="flex items-center gap-2 px-5 pt-4">
                <button class="rounded-full bg-white/20 px-3 py-1 text-sm font-bold" @click="page = 'home'">‹ Back</button>
                <div class="font-display text-lg font-semibold">{{ TITLES[page] }}</div>
              </div>
              <div class="kk-scroll m-3 mb-6 min-h-0 flex-1 overflow-y-auto rounded-3xl bg-white/95 p-3">
                <PhoneSchool v-if="page === 'school'" />
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
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2 px-5 pt-5">
                <button class="rounded-full bg-white/20 px-3 py-1 text-sm font-bold" @click="page = 'home'">‹ Back</button>
                <div class="font-display text-lg font-semibold">Settings</div>
              </div>
              <div class="m-4 space-y-2 rounded-3xl bg-white/95 p-3 text-ink">
                <div class="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">Sound <AudioSystem /></div>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold hover:bg-ink/5" @click="(voices = !voices), setVoicesOn(voices)">
                  Voices (greetings, market calls) <span class="kk-chip">{{ voices ? 'On' : 'Off' }}</span>
                </button>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold hover:bg-ink/5" @click="setQuality(quality === 'low' ? 'high' : 'low')">
                  Graphics <span class="kk-chip">{{ quality === 'low' ? '⚡ Lite' : '✨ HD' }}</span>
                </button>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold hover:bg-ink/5" @click="(editLook = true), (open = false)">
                  Change my look <span>›</span>
                </button>
                <NuxtLink to="/arcade" class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold hover:bg-ink/5">
                  Arcade (full screen) <span>›</span>
                </NuxtLink>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold hover:bg-ink/5" @click="(sim.tourDone = false), sim.save(), (open = false)">
                  Replay the tour <span>›</span>
                </button>
                <button class="flex w-full items-center justify-between rounded-2xl px-2 py-2 text-sm font-semibold text-red-600 hover:bg-red-50" @click="sim.reset(), (open = false)">
                  Create a new Sim <span>›</span>
                </button>
              </div>
            </template>
            <div class="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/70" />
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
