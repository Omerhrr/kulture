<script setup lang="ts">
// Game page — auth gate, world bootstrap, socket wiring, panel orchestration.

useHead({ title: 'Kaduna Kulture — Enter the World' })

const player = usePlayerStore()
const world = useWorldStore()
const ui = useUiStore()
const payments = usePaymentsStore()

const authMode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const authError = ref('')
const authBusy = ref(false)

const ready = ref(false)

// keyboard shortcuts
function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'e' || e.key === 'E') {
    const prox = useState<{ entityId: string } | null>('kk_proximity').value
    if (prox && !ui.anyBlocking) ui.interactWith(prox as any)
  }
  if (e.key === 'Escape') ui.closeAll()
  if (e.key === 'i' || e.key === 'I') ui.open('inventory')
  if (e.key === 'j' || e.key === 'J') ui.open('jobs')
  if (e.key === 't' || e.key === 'T') ui.open('ledger')
}

async function bootstrap() {
  const api = useGameApi()
  await world.load()
  const [me, inv, jobs] = await Promise.all([api.me(), api.inventory(), api.myJobs()])
  player.applyPlayer(me)
  player.applyInventory(inv.items)
  player.jobs = jobs
  if (me.position) {
    useState<[number, number, number]>('kk_player_pos').value = [
      me.position[0],
      me.position[1],
      me.position[2]
    ]
  }
  useState('kk_player_id').value = me.id
  localStorage.setItem('kk_player_id', me.id)
  ready.value = true
}

const socket = useGameSocket()

onMounted(async () => {
  window.addEventListener('keydown', onKey)
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
      // resync after (re)connect — authoritative snapshot
      world.load().catch(() => {})
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
})

onUnmounted(() => window.removeEventListener('keydown', onKey))

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
  <div class="relative h-screen w-screen overflow-hidden bg-kakano">
    <!-- 3D world -->
    <ClientOnly>
      <GameCanvas v-if="ready" />
      <template #fallback>
        <div class="flex h-full items-center justify-center text-white/50">Loading world…</div>
      </template>
    </ClientOnly>

    <!-- auth gate -->
    <div v-if="!player.authenticated" class="absolute inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-kakano via-kadeep/60 to-kakano p-4">
      <div class="kk-panel w-[min(420px,94vw)] p-6">
        <div class="mb-1 text-2xl font-black text-kasand">Kaduna Kulture</div>
        <div class="mb-5 text-sm text-white/60">A living Kaduna. An economy powered by Bitcoin.</div>

        <div class="mb-4 flex gap-2">
          <button class="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold" :class="authMode === 'login' ? 'bg-kasand text-kakano' : 'border border-white/15 text-white/70'" @click="authMode = 'login'">Login</button>
          <button class="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold" :class="authMode === 'register' ? 'bg-kasand text-kakano' : 'border border-white/15 text-white/70'" @click="authMode = 'register'">Register</button>
        </div>

        <form class="space-y-3" @submit.prevent="submitAuth">
          <input v-model="username" class="kk-input" placeholder="Username" required minlength="3" />
          <input v-model="password" class="kk-input" type="password" placeholder="Password" required minlength="8" />
          <input v-if="authMode === 'register'" v-model="displayName" class="kk-input" placeholder="Display name" />
          <button class="kk-btn-primary w-full" type="submit" :disabled="authBusy">
            {{ authBusy ? 'One moment…' : authMode === 'login' ? 'Enter the world' : 'Create account' }}
          </button>
        </form>

        <p v-if="authError" class="mt-3 rounded bg-red-500/15 p-2 text-xs text-red-200">{{ authError }}</p>

        <div class="mt-4 rounded-lg bg-white/5 p-3 text-xs text-white/50">
          <b class="text-kacream/80">Demo account</b><br />
          username <code class="text-kasand">demo_player</code> · password <code class="text-kasand">kaduna-demo-2026</code>
        </div>
      </div>
    </div>

    <!-- in-game UI -->
    <template v-if="ready && player.authenticated">
      <Hud @open="(p) => ui.open(p)" />
      <InteractionPrompt />
      <ShopPanel v-if="ui.openPanel === 'shop'" />
      <InventoryPanel v-if="ui.openPanel === 'inventory'" />
      <JobsPanel v-if="ui.openPanel === 'jobs'" />
      <LedgerPanel v-if="ui.openPanel === 'ledger'" />

      <!-- POS kiosk info panel -->
      <div v-if="ui.openPanel === 'pos'" class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(380px,92vw)] kk-panel p-4 sm:right-4">
        <div class="mb-3 flex items-center justify-between">
          <div class="text-base font-bold text-kasand">⚡ Arewa QuickPOS</div>
          <button class="kk-btn-ghost !px-2 !py-1" @click="ui.open('pos')">✕</button>
        </div>
        <div class="space-y-2 text-sm text-white/70">
          <p>This Lightning-powered kiosk is the reference point for real-sat payments in Kaduna Kulture.</p>
          <p class="text-[12px] text-white/45">
            Lightning node health and settlement stats are available on the demo dashboard. Player
            withdrawals and custodial balances are intentionally out of scope for the MVP.
          </p>
          <div class="rounded-lg bg-white/5 p-3 text-[12px]">
            <div class="font-semibold text-kacream/80">Asset classes (never mixed):</div>
            <div>⚡ Real Bitcoin sats — verified Lightning settlements</div>
            <div>💰 Simulated NGN — game-only currency ({{ fmtNgn(player.profile?.ngn_balance_minor || 0) }})</div>
            <div>⭐ Reputation — progression, not money</div>
          </div>
        </div>
      </div>

      <!-- interaction option sheet -->
      <div v-if="ui.interaction" class="pointer-events-auto absolute inset-x-0 bottom-28 z-30 flex justify-center px-3">
        <div class="kk-panel w-[min(460px,94vw)] p-4">
          <div class="mb-2 flex items-center justify-between">
            <div class="text-sm font-bold text-kasand">{{ ui.interaction.entity_name }}</div>
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
            class="kk-panel px-4 py-2 text-sm font-semibold"
            :class="ui.toastKind === 'error' ? 'text-red-300' : ui.toastKind === 'success' ? 'text-emerald-300' : 'text-kacream'"
          >
            {{ ui.toast }}
          </div>
        </div>
      </transition>

      <!-- controls hint -->
      <div class="pointer-events-none absolute bottom-4 left-4 z-20 hidden text-[11px] text-white/40 sm:block">
        WASD / arrows to move · E to interact · I inventory · J jobs · T ledger · Esc close
      </div>
    </template>
  </div>
</template>
