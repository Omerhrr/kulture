<script setup lang="ts">
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

const authMode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const authError = ref('')
const authBusy = ref(false)

const ready = ref(false)

// unified action key: exit vehicle > board vehicle > door > entity interact
function tryInteract() {
  const ride = useRide().value
  const doorPrompt = useDoorPrompt().value
  if (ride.active || ride.prompt) {
    fireKkEvent('kk-ride-toggle')
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
  if (e.key === 'e' || e.key === 'E') tryInteract()
  if (e.key === 'Escape') {
    if (mapOpen.value) mapOpen.value = false
    else ui.closeAll()
  }
  if (e.key === 'i' || e.key === 'I') ui.open('inventory')
  if (e.key === 'j' || e.key === 'J') ui.open('jobs')
  if (e.key === 't' || e.key === 'T') ui.open('ledger')
  if (e.key === 'm' || e.key === 'M') mapOpen.value = !mapOpen.value
  if (e.key === 'v' || e.key === 'V') fireKkEvent('kk-ride-view')
}

async function bootstrap() {
  const api = useGameApi()
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
  ready.value = true
}

const socket = useGameSocket()

onMounted(async () => {
  try {
    // temporary debug: capture uncaught RAF errors (loop killer detection)
    window.addEventListener('error', (e) => {
      ;(window as any).__kk_win_err = (window as any).__kk_win_err || []
      ;(window as any).__kk_win_err.push(
        `${e.message} @ ${String(e.filename).split('/').slice(-2).join('/')}:${e.lineno}`
      )
    })
    window.addEventListener('keydown', onKey)
    window.addEventListener('kk-do-interact', tryInteract)
  player.token = localStorage.getItem('kk_token') || ''
  player.authenticated = !!player.token
  if (!player.authenticated) return

  // socket event wiring (server events are the only source of truth)
  useState('kk_socket_send').value = socket.send
  socket.onMessage((ev) => {
    player.handleServerEvent(ev)
    world.handleServerEvent(ev)
    payments.onServerEvent(ev)
    if (ev.type === 'npc.dialogue') {
      ui.dialogue = {
        npcName: ev.payload?.npc_name || 'NPC',
        text: ev.payload?.dialogue || '',
        engine: ev.payload?.engine || 'deterministic_fallback'
      }
    }
  })
  socket.onMessage((ev) => {
    if (ev.type === 'player.state' && ev.payload?.reason === 'connected') {
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
  })
  socket.connect()

  try {
    await bootstrap()
  } catch (e: any) {
    if (e?.status === 401) {
      player.logout()
    } else {
      ui.showToast(e.message || 'World failed to load', 'error')
    }
  }
  } catch (e: any) {
    ;(window as any).__kk_game_err = String(e?.stack || e)
    throw e
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('kk-do-interact', tryInteract)
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
    // re-wire socket with the fresh token
    socket.disconnect()
    useState('kk_socket_send').value = socket.send
    socket.onMessage((ev) => {
      player.handleServerEvent(ev)
      world.handleServerEvent(ev)
      payments.onServerEvent(ev)
      if (ev.type === 'npc.dialogue') {
        ui.dialogue = {
          npcName: ev.payload?.npc_name || 'NPC',
          text: ev.payload?.dialogue || '',
          engine: ev.payload?.engine || 'deterministic_fallback'
        }
      }
    })
    socket.connect()
    await bootstrap()
  } catch (e: any) {
    authError.value = e.message || 'Authentication failed'
  } finally {
    authBusy.value = false
  }
}

function fmtNgn(minor: number) {
  return `₦${(minor / 100).toLocaleString('en-NG')}`
}
</script>

<template>
  <div class="relative h-[100dvh] w-full overflow-hidden overscroll-none bg-paper">
    <!-- 3D world -->
    <ClientOnly>
      <GameCanvas v-if="ready" />
      <template #fallback>
        <div class="flex h-full items-center justify-center text-ink/50">Loading world...</div>
      </template>
    </ClientOnly>

    <!-- auth gate: light, Lagos Life style -->
    <div
      v-if="!player.authenticated"
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
            <input id="kk-username" v-model="username" class="kk-input" placeholder="e.g. danladi" required minlength="3" autocomplete="username" />
          </div>
          <div>
            <label class="kk-label" for="kk-password">Password</label>
            <input id="kk-password" v-model="password" class="kk-input" type="password" placeholder="8+ characters" required minlength="8" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" />
          </div>
          <div v-if="authMode === 'register'">
            <label class="kk-label" for="kk-display">Display name</label>
            <input id="kk-display" v-model="displayName" class="kk-input" placeholder="What the city calls you" />
          </div>
          <button class="kk-btn-primary w-full !py-3 !text-base" type="submit" :disabled="authBusy">
            {{ authBusy ? 'One moment...' : authMode === 'login' ? 'Enter the world' : 'Create my account' }}
          </button>
        </form>

        <p v-if="authError" class="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-semibold text-red-600">{{ authError }}</p>

        <div class="mt-5 rounded-2xl bg-paper p-3.5 text-center text-xs leading-relaxed text-ink/55">
          Just looking around? Use the demo account:
          <div class="mt-1 font-bold text-golddark">demo_player / kaduna-demo-2026</div>
        </div>
      </div>
    </div>

    <!-- in-game UI -->
    <template v-if="ready && player.authenticated">
      <Hud @open="(p) => ui.open(p)" />
      <Minimap />
      <MapOverlay />
      <MobileControls />
      <InteractionPrompt />
      <ShopPanel v-if="ui.openPanel === 'shop'" />
      <InventoryPanel v-if="ui.openPanel === 'inventory'" />
      <JobsPanel v-if="ui.openPanel === 'jobs'" />
      <LedgerPanel v-if="ui.openPanel === 'ledger'" />

      <!-- POS kiosk info panel -->
      <div v-if="ui.openPanel === 'pos'" class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(380px,92vw)] kk-panel p-4 sm:right-4">
        <div class="mb-3 flex items-center justify-between">
          <div class="text-base font-bold text-ink">⚡ Arewa QuickPOS</div>
          <button class="kk-btn-ghost !px-2 !py-1" @click="ui.open('pos')">✕</button>
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
            <div>💰 Simulated NGN - game-only currency ({{ fmtNgn(player.profile?.ngn_balance_minor || 0) }})</div>
            <div>⭐ Reputation - progression, not money</div>
          </div>
        </div>
      </div>

      <!-- interaction option sheet -->
      <div v-if="ui.interaction" class="pointer-events-auto absolute inset-x-0 bottom-28 z-30 flex justify-center px-3">
        <div class="kk-panel w-[min(460px,94vw)] p-4">
          <div class="mb-2 flex items-center justify-between">
            <div class="text-sm font-bold text-ink">{{ ui.interaction.entity_name }}</div>
            <button class="kk-btn-ghost !px-2 !py-0.5 text-xs" @click="ui.interaction = null">✕</button>
          </div>
          <div class="space-y-2">
            <button
              v-for="(o, i) in ui.interaction.options"
              :key="i"
              class="kk-btn-ghost w-full !justify-start"
              @click="ui.chooseOption(o)"
            >
              {{ o.kind === 'shop' ? '🛒' : o.kind === 'job_board' ? '🧾' : o.kind === 'pos_kiosk' ? '⚡' : '💬' }}
              {{ o.label }}
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
        v-if="!isTouch"
        class="pointer-events-none absolute bottom-4 left-4 z-20 rounded-2xl bg-ink/45 px-3.5 py-2 text-[11px] leading-relaxed text-white/90 backdrop-blur-sm"
      >
        <div>WASD or arrows to walk · Shift to sprint · click the ground to go there</div>
        <div>E board a keke, car, okada, bus, boat or plane · V inner view · M city map</div>
      </div>
      <div
        v-else
        class="pointer-events-none absolute bottom-44 left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-ink/45 px-3.5 py-2 text-center text-[11px] leading-relaxed text-white/90 backdrop-blur-sm"
      >
        <div>left stick to move (push fully to sprint) · drag to look · pinch to zoom</div>
        <div>tap the ground to walk there · TALK to board vehicles and enter homes</div>
      </div>
    </template>
  </div>
</template>
