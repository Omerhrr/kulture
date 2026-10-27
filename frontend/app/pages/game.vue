<script setup lang="ts">
import { REGIONS, REGION_ID } from '~/utils/regions'
import { useSimStore } from '~/stores/sim'
import { useWorkStore } from '~/stores/work'
import { useAdsStore } from '~/stores/ads'
// Game page - auth gate, world bootstrap, socket wiring, panel orchestration.

import { unstick } from '~/utils/collision'
import { useMapOpen, fireKkEvent } from '~/composables/useControlsState'

useHead({
  title: 'Kaduna Kulture - Enter the World',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
})

const player = usePlayerStore()
const world = useWorldStore()
const ui = useUiStore()
const payments = usePaymentsStore()
const isTouch = useIsTouch()
const mapOpen = useMapOpen()

// /game?signup opens "Create account" (new visitors), plain /game opens log in
const authMode = ref<'login' | 'register'>(useRoute().query.signup !== undefined ? 'register' : 'login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const authError = ref('')
const authBusy = ref(false)

const ready = ref(false)
const sim = useSimStore()
const work = useWorkStore()
const ads = useAdsStore()
const cityMap = useCityMap()
const nearBoard = useState<string | null>('kk_billboard_near', () => null)
const phoneOpen = useState<boolean>('kk_phone_open', () => false)
// true until we know whether a saved session exists (avoids login flash)
const booting = ref(true)
const showHint = ref(true)
let hintTimer: ReturnType<typeof setTimeout> | undefined

// unified action key: exit vehicle > board vehicle > chat to a pedestrian >
// door > entity interact
function tryInteract() {
  const ride = useRide().value
  const pedPrompt = useState<{ id: number } | null>('kk_ped_prompt').value
  const doorPrompt = useDoorPrompt().value
  if (ride.active || ride.prompt) {
    fireKkEvent('kk-ride-toggle')
    return
  }
  if (pedPrompt) {
    fireKkEvent('kk-ped-talk')
    return
  }
  if (doorPrompt) {
    fireKkEvent('kk-door-use')
    return
  }
  const prox = useState<{ entityId: string } | null>('kk_proximity').value
  if (prox && !ui.anyBlocking) ui.interactWith(prox as any)
}

// keyboard shortcuts
function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) return
  // holding a key auto-repeats keydown: it must not mash the toggles
  // (enter/exit doors, map, time-skip, horn...)
  if (e.repeat) return
  // number keys pick an option on the interaction sheet
  if (ui.interaction && /^[1-9]$/.test(e.key)) {
    const o = ui.interaction.options[+e.key - 1]
    if (o) ui.chooseOption(o)
    return
  }
  if (e.key === 'e' || e.key === 'E') tryInteract()
  if (e.key === 'Escape') {
    const ask = useState<boolean>('kk_ask_open')
    if (ask.value) return void (ask.value = false)
    if (phoneOpen.value) return void (phoneOpen.value = false)
    if (ads.sheetBoard) return void (ads.sheetBoard = null)
    if (cityMap.value.active) return void (cityMap.value.active = false)
    const wk = useState<boolean>('kk_work_open')
    if (wk.value) return void (wk.value = false)
    if (mapOpen.value) mapOpen.value = false
    else ui.closeAll()
  }
  if (e.key === 'i' || e.key === 'I') ui.open('inventory')
  if (e.key === 'j' || e.key === 'J') ui.open('jobs')
  if (e.key === 't' || e.key === 'T') ui.open('ledger')
  if (e.key === 'm' || e.key === 'M') cityMap.value.active = !cityMap.value.active
  if (e.key === 'v' || e.key === 'V') fireKkEvent('kk-ride-view')
  if (e.key === 'n' || e.key === 'N') fireKkEvent('kk-time-skip')
  if (e.key === 'y' || e.key === 'Y') fireKkEvent('kk-weather')
  if (e.key === 'h' || e.key === 'H') fireKkEvent('kk-horn')
  if (e.key === 'p' || e.key === 'P') {
    const t = window as any
    if (t.__kk_toggle_mute) t.__kk_toggle_mute()
  }
}

async function bootstrap() {
  const api = useGameApi()
  const me0 = await api.me()
  // the server decides which town you're in; load that town's map
  const town = REGIONS.find((r) => r.slug === (me0 as any).region_slug)?.id ?? 'kaduna'
  if (town !== REGION_ID) {
    try {
      localStorage.setItem('kk_region', town)
    } catch {}
    window.location.reload()
    return
  }
  await world.load()
  const [me, inv, jobs] = await Promise.all([api.me(), api.inventory(), api.myJobs()])
  player.applyPlayer(me)
  player.applyInventory(inv.items)
  player.jobs = jobs
  if (me.position) {
    // A stale persisted position can sit inside a building footprint and
    // trap the character; nudge it to the nearest free spot before seeding.
    const [sx, sz] = unstick(me.position[0], me.position[2])
    useState<[number, number, number]>('kk_player_pos').value = [sx, 0, sz]
  }
  useState('kk_player_id').value = me.id
  localStorage.setItem('kk_player_id', me.id)
  if (sim.owner !== me.id) sim.load(me.id) // this account's character, not the last visitor's
  ready.value = true
}

const socket = useGameSocket()
if (import.meta.client) (window as any).__kk_ws_send = (type: string, payload: Record<string, unknown>) => socket.send(type, payload)

// Socket event wiring (server events are the only source of truth). Used for
// both a restored session and a fresh login, so the two can never drift apart.
let unsubscribeSocket: Array<() => void> = []
function wireSocket() {
  unsubscribeSocket.forEach((off) => off())
  unsubscribeSocket = []
  socket.disconnect()
  useState('kk_socket_send').value = socket.send
  unsubscribeSocket.push(socket.onMessage((ev) => {
    player.handleServerEvent(ev)
    world.handleServerEvent(ev)
    payments.onServerEvent(ev)
    if (ev.type === 'npc.dialogue') {
      if (ev.payload?.npc) useGameApi().apiPost('/social/met', { npc_id: ev.payload.npc, name: ev.payload?.npc_name || 'Friend' }).catch(() => {})
      ui.dialogue = {
        npcName: ev.payload?.npc_name || 'NPC',
        text: ev.payload?.dialogue || '',
        engine: ev.payload?.engine || 'deterministic_fallback'
      }
    }
  }))
  unsubscribeSocket.push(socket.onMessage((ev) => {
    // other players nearby + the real online count (1 Hz from the server)
    if (ev.type === 'players.snapshot') {
      useState('kk_players').value = ev.payload
      if (import.meta.dev) (window as any).__kk_snap = ev.payload
      return
    }
    // the server granted a commute skip: land where it says
    if (ev.type === 'commute.arrived' && Array.isArray(ev.payload?.position)) {
      window.dispatchEvent(new CustomEvent('kk-commute-arrived', { detail: ev.payload.position }))
      return
    }
    // someone nearby jumped / punched / waved: animate their avatar
    if (ev.type === 'player.emote') {
      window.dispatchEvent(new CustomEvent('kk-remote-emote', { detail: ev.payload }))
      return
    }
    // another player's punch / kick / push landed on us (server-validated)
    if (ev.type === 'player.hit') {
      window.dispatchEvent(new CustomEvent('kk-player-hit', { detail: ev.payload }))
      ui.showToast(`@${ev.payload?.from} ${ev.payload?.action === 'push' ? 'pushed' : ev.payload?.action === 'kick' ? 'kicked' : 'punched'} you!`, 'info')
      return
    }
    // a billboard ad went on air somewhere: repaint the boards
    if (ev.type === 'ads.updated') {
      ads.refresh().catch(() => {})
      return
    }
    // shift pay landed in the ledger: pull the fresh balance
    if (ev.type === 'player.balance') {
      socket.send('state.resync', {})
      return
    }
    if (ev.type === 'player.state' && ev.payload?.reason === 'connected') {
      // tell everyone what we look like (validated server-side)
      socket.send('player.look', { look: sim.look, name: sim.name })
      work.refresh().catch(() => {})
      // resync after (re)connect - authoritative snapshot
      world.load().catch(() => {})
    }
    if (ev.type === 'player.position_corrected' && Array.isArray(ev.payload?.position)) {
      // Movement authority: the server reconciled an over-speed move (teleport
      // attempt) - snap the locally predicted avatar to the authoritative pos.
      // Dev teleports (headless surveying) are exempt for a short window.
      const tpAt = (window as any).__kk_teleport_at || 0
      if (Date.now() - tpAt < 1500) return
      const [x, y, z] = ev.payload.position as [number, number, number]
      useState<[number, number, number]>('kk_player_pos').value = [x, y, z]
    }
  }))
  socket.connect()
}

// re-announce our look/name whenever the character changes (no-op when offline)
watch(
  () => [sim.name, JSON.stringify(sim.look)],
  () => socket.send('player.look', { look: sim.look, name: sim.name })
)

async function startSession() {
  wireSocket()
  try {
    await bootstrap()
  } catch (e: any) {
    if (e?.status === 401) {
      player.logout()
      socket.disconnect()
    } else {
      ui.showToast(e.message || 'World failed to load', 'error')
    }
  }
}

// the server no longer accepts our token (expired after KK_JWT_EXPIRE_MINUTES)
function onAuthExpired() {
  if (!player.authenticated) return
  unsubscribeSocket.forEach((off) => off())
  unsubscribeSocket = []
  socket.disconnect()
  player.logout()
  ready.value = false
  authMode.value = 'login'
  authError.value = 'Your session expired. Please log in again.'
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('kk-do-interact', tryInteract)
  window.addEventListener('kk-auth-expired', onAuthExpired)
  player.token = localStorage.getItem('kk_token') || ''
  player.authenticated = !!player.token
  sim.load()
  booting.value = false
  hintTimer = setTimeout(() => (showHint.value = false), 15000)
  if (player.authenticated) await startSession()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('kk-do-interact', tryInteract)
  window.removeEventListener('kk-auth-expired', onAuthExpired)
  unsubscribeSocket.forEach((off) => off())
  if (hintTimer) clearTimeout(hintTimer)
})

async function submitAuth() {
  authBusy.value = true
  authError.value = ''
  try {
    const api = useGameApi()
    const res =
      authMode.value === 'login'
        ? await api.login(username.value, password.value)
        : await api.register(username.value, password.value, displayName.value || username.value)
    player.setToken(res.access_token)
    await startSession()
  } catch (e: any) {
    authError.value = e.message || 'Authentication failed'
  } finally {
    authBusy.value = false
  }
}

function fmtKsats(minor: number) {
  return `${Math.round(minor).toLocaleString('en')} ks`
}
</script>

<template>
  <div class="relative h-[100dvh] w-full overflow-hidden overscroll-none bg-paper">
    <!-- 3D world -->
    <ClientOnly>
      <GameCanvas v-if="ready" />
      <div v-else-if="booting || player.authenticated" class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#cfe3d8] via-paper to-[#f3e3c0] text-ink/60"><div class="h-10 w-10 animate-spin rounded-full border-4 border-kadeep/20 border-t-kadeep" /><div class="font-display text-sm font-semibold">Building Kaduna...</div></div>
      <template #fallback>
        <div class="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#cfe3d8] via-paper to-[#f3e3c0] text-ink/60"><div class="h-10 w-10 animate-spin rounded-full border-4 border-kadeep/20 border-t-kadeep" /><div class="font-display text-sm font-semibold">Building Kaduna...</div></div>
      </template>
    </ClientOnly>

    <!-- auth gate: light, Lagos Life style -->
    <div
      v-if="!player.authenticated && !booting"
      class="absolute inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-[#cfe3d8] via-paper to-[#f3e3c0] p-4"
    >
      <div class="w-[min(440px,94vw)] rounded-[2rem] bg-white p-7 shadow-2xl shadow-ink/15 sm:p-9">
        <div class="mb-6 text-center">
          <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-kadeep text-2xl shadow-lg shadow-kadeep/25">🛺</div>
          <h1 class="font-display text-2xl font-semibold tracking-tight">Kaduna Kulture</h1>
          <p class="mt-1 text-sm text-ink/50">Live the city. Move real money.</p>
        </div>

        <!-- segmented tab control -->
        <div class="mb-5 flex rounded-full bg-ink/5 p-1">
          <button
            class="flex-1 rounded-full px-3 py-2 text-sm font-bold transition-all"
            :class="authMode === 'login' ? 'bg-white text-ink shadow-md' : 'text-ink/45 hover:text-ink/70'"
            @click="authMode = 'login'"
          >
            Log in
          </button>
          <button
            class="flex-1 rounded-full px-3 py-2 text-sm font-bold transition-all"
            :class="authMode === 'register' ? 'bg-white text-ink shadow-md' : 'text-ink/45 hover:text-ink/70'"
            @click="authMode = 'register'"
          >
            Create account
          </button>
        </div>

        <form class="space-y-3.5" @submit.prevent="submitAuth">
          <div>
            <label class="kk-label" for="kk-username">Username</label>
            <input id="kk-username" v-model="username" class="kk-input" placeholder="e.g. danladi" required minlength="3" maxlength="32" :pattern="authMode === 'register' ? '[A-Za-z0-9_]+' : undefined" title="Letters, numbers and _ only" autocomplete="username" autocapitalize="none" spellcheck="false" />
            <p v-if="authMode === 'register'" class="mt-1 text-[11px] text-ink/45">3-32 letters, numbers or _ · not case-sensitive</p>
          </div>
          <div>
            <label class="kk-label" for="kk-password">Password</label>
            <input id="kk-password" v-model="password" class="kk-input" type="password" placeholder="8+ characters" required minlength="8" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" />
          </div>
          <div v-if="authMode === 'register'">
            <label class="kk-label" for="kk-display">Display name</label>
            <input id="kk-display" v-model="displayName" class="kk-input" maxlength="32" placeholder="What the city calls you" />
          </div>
          <button class="kk-btn-primary w-full !py-3 !text-base" type="submit" :disabled="authBusy">
            {{ authBusy ? 'One moment...' : authMode === 'login' ? 'Enter the world' : 'Create my account' }}
          </button>
        </form>

        <p v-if="authError" class="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-semibold text-red-600">{{ authError }}</p>

        <p class="mt-5 text-center text-xs text-ink/50">
          <template v-if="authMode === 'login'">New to Kaduna? <button class="font-bold text-kadeep underline-offset-2 hover:underline" @click="(authMode = 'register'), (authError = '')">Create a free account</button></template>
          <template v-else>Already playing? <button class="font-bold text-kadeep underline-offset-2 hover:underline" @click="(authMode = 'login'), (authError = '')">Log in</button></template>
        </p>
      </div>
    </div>

    <!-- in-game UI -->
    <template v-if="ready && player.authenticated">
      <SimHud @settings="phoneOpen = true">
        <ObjectiveTracker />
      </SimHud>
      <Minimap v-show="!ui.openPanel && !sim.cleanScreen && !cityMap.active" />
      <Dock v-show="!sim.cleanScreen" />
      <CityMap />
      <BillboardSheet />
      <BuildPanel />
      <!-- near a billboard: see what's on air / book it -->
      <button
        v-if="nearBoard && !cityMap.active && !ads.sheetBoard && !ui.anyBlocking"
        class="pointer-events-auto absolute bottom-28 right-3 z-20 flex items-center gap-2 rounded-full bg-white/95 py-2 pl-2 pr-4 text-sm font-bold text-ink shadow-xl sm:right-4"
        @click="ads.open(nearBoard)"
      >
        <span class="flex h-8 w-8 items-center justify-center rounded-full bg-rose-100">📢</span>View ads · book this board
      </button>
      <Phone />
      <WorkApp />
      <RaceHud />
      <LifeEvents />
      <SocialNotices />
      <RideInvite />
      <VoiceSystem />
      <CommuteCard />
      <ShiftCard v-if="!work.commute?.active" />
      <AskSheet />
      <Tour v-if="sim.created && !sim.tourDone" />
      <CharacterCreator v-if="!sim.created" />
      <MapOverlay />
      <MobileControls />
      <InteractionPrompt v-show="!cityMap.active" />
      <AudioSystem />
      <ShopPanel v-if="ui.openPanel === 'shop'" />
      <InventoryPanel v-if="ui.openPanel === 'inventory'" />
      <JobsPanel v-if="ui.openPanel === 'jobs'" />
      <LedgerPanel v-if="ui.openPanel === 'ledger'" />

      <!-- POS kiosk info panel -->
      <div v-if="ui.openPanel === 'pos'" class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(380px,92vw)] kk-panel p-4 sm:right-4">
        <div class="mb-3 flex items-center justify-between">
          <div class="text-base font-bold text-ink">⚡ Arewa QuickPOS</div>
          <button class="kk-close" aria-label="Close" @click="ui.open('pos')">✕</button>
        </div>
        <div class="space-y-2 text-sm text-ink/70">
          <p>This Lightning-powered kiosk is the reference point for real-sat payments in Kaduna Kulture.</p>
          <p class="text-[12px] text-ink/45">
            Lightning node health and settlement stats are available on the demo dashboard. Player
            withdrawals and custodial balances are intentionally out of scope for the MVP.
          </p>
          <div class="rounded-2xl bg-paper p-3 text-[12px]">
            <div class="font-bold text-ink/75">Asset classes (never mixed):</div>
            <div>⚡ Real Bitcoin sats - verified Lightning settlements</div>
            <div>💰 k-sats - game-only currency ({{ fmtKsats(player.profile?.ksats_balance || 0) }}). Deposit Lightning sats: 1 sat = 1,000 k-sats.</div>
            <div>⭐ Reputation - progression, not money</div>
          </div>
        </div>
      </div>

      <!-- interaction option sheet: primary action first, numbered for keyboard -->
      <div v-if="ui.interaction" class="pointer-events-auto absolute inset-x-0 bottom-28 z-30 flex justify-center px-3">
        <div class="kk-panel w-[min(420px,94vw)] p-4" role="dialog" :aria-label="ui.interaction.entity_name">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <div class="text-[10px] font-extrabold uppercase tracking-[0.14em] text-kadeep/60">What would you like to do?</div>
              <div class="font-display text-lg font-semibold leading-tight text-ink">{{ ui.interaction.entity_name }}</div>
            </div>
            <button class="kk-close" aria-label="Close" @click="ui.interaction = null">✕</button>
          </div>
          <div class="space-y-2">
            <button
              v-for="(o, i) in ui.interaction.options"
              :key="i"
              class="group flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-kadeep/60"
              :class="i === 0 ? 'border-kadeep bg-kadeep text-white hover:bg-leaf' : 'border-ink/10 bg-white text-ink hover:border-ink/25'"
              @click="ui.chooseOption(o)"
            >
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base" :class="i === 0 ? 'bg-white/15' : 'bg-paper'">
                {{ o.kind === 'shop' ? '🛒' : o.kind === 'job_board' ? '🧾' : o.kind === 'pos_kiosk' ? '⚡' : '💬' }}
              </span>
              <span class="flex-1">{{ o.label }}</span>
              <kbd v-if="!isTouch" class="rounded-md border px-1.5 font-mono text-[10px]" :class="i === 0 ? 'border-white/30 text-white/70' : 'border-ink/15 text-ink/40'">{{ i + 1 }}</kbd>
            </button>
          </div>
        </div>
      </div>

      <DialogueBox />
      <LightningPaymentDialog />

      <!-- toast -->
      <transition enter-active-class="transition duration-200" enter-from-class="translate-y-3 opacity-0">
        <div v-if="ui.toast" class="pointer-events-none absolute inset-x-0 bottom-40 z-50 flex justify-center">
          <div
            class="kk-panel px-4 py-2 text-sm font-bold"
            :class="ui.toastKind === 'error' ? 'text-red-600' : ui.toastKind === 'success' ? 'text-leaf' : 'text-ink'"
          >
            {{ ui.toast }}
          </div>
        </div>
      </transition>

      <!-- controls hint (sits directly on the 3D world) -->
      <div
        v-if="!isTouch && !showHint"
        class="pointer-events-auto absolute bottom-24 left-4 z-20"
      ><button class="kk-btn-ghost !px-3 !py-1.5 text-xs" @click="showHint = true">? Controls</button></div>
      <div
        v-else-if="!isTouch"
        class="pointer-events-auto absolute bottom-24 left-4 cursor-pointer z-20 rounded-2xl bg-ink/45 px-3.5 py-2 text-[11px] leading-relaxed text-white/90 backdrop-blur-sm"
      >
        <div>WASD or arrows to walk · Shift to sprint · click the ground to go there · Y weather · V camera view (1st / 2nd / 3rd person)</div>
        <div>E talk, board a keke, car, okada, bus, boat or plane, or enter homes · V inner view</div>
        <div>M city map · N skip 2 hours · H horn · P sound on/off <button class="ml-2 underline" @click="showHint = false">hide</button></div>
      </div>
      <div
        v-else-if="showHint"
        class="pointer-events-auto absolute bottom-44 left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-ink/45 px-3.5 py-2 text-center text-[11px] leading-relaxed text-white/90 backdrop-blur-sm"
      >
        <div>left stick to move (push fully to sprint) · drag to look · pinch to zoom</div>
        <div @click="showHint = false">tap the ground to walk there · TALK to chat, board vehicles and enter homes · tap to hide</div>
      </div>
    </template>
  </div>
</template>
