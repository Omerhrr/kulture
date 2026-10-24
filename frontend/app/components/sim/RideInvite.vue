<script setup lang="ts">
// RideInvite - while you drive, invite players standing near you to ride
// along (they get a pop-up to accept). While you ride in someone else's
// vehicle, a chip shows whose ride it is and how to get out.
const party = useState<{ role: 'none' | 'driver' | 'passenger'; seatsFree: number; names: string[] }>('kk_ride_party', () => ({ role: 'none', seatsFree: 0, names: [] }))
const partyIds = useState<string[]>('kk_ride_party_ids', () => [])
const players = useState<{ online: number; players: Array<{ id: string; name: string; pos: [number, number, number] }> }>('kk_players', () => ({ online: 0, players: [] }))
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [0, 0, 0])
const open = ref(false)
const sent = ref<Record<string, number>>({})
// a clock so "Sent" turns back into "Invite" after 15 s
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => (tick = setInterval(() => (now.value = Date.now()), 1000)))
onBeforeUnmount(() => clearInterval(tick))

const nearby = computed(() =>
  players.value.players
    .filter((p) => !partyIds.value.includes(p.id))
    .map((p) => ({ ...p, d: Math.hypot(p.pos[0] - playerPos.value[0], p.pos[2] - playerPos.value[2]) }))
    .filter((p) => p.d < 45)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6)
)
function invite(p: { id: string; name: string }) {
  sent.value[p.id] = Date.now()
  now.value = Date.now()
  window.dispatchEvent(new CustomEvent('kk-ride-invite', { detail: { to: p.id, name: p.name } }))
}
watch(
  () => party.value.role,
  (r: 'none' | 'driver' | 'passenger') => r !== 'driver' && (open.value = false)
)
</script>

<template>
  <div v-if="party.role === 'driver'" class="pointer-events-auto absolute left-3 top-[9.75rem] z-20 w-[min(240px,70vw)]">
    <button class="rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-ink shadow backdrop-blur" @click="open = !open">
      👥 Invite riders <span class="text-ink/50">· {{ party.seatsFree }} seat{{ party.seatsFree === 1 ? '' : 's' }} free</span>
    </button>
    <div v-if="party.names.length" class="mt-1 rounded-2xl bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-ink shadow">With you: {{ party.names.join(', ') }}</div>
    <div v-if="open" class="mt-1 space-y-1 rounded-2xl bg-white/95 p-2 text-xs text-ink shadow-lg">
      <div v-if="!nearby.length" class="p-1 text-ink/55">No players near you right now. Friends need to be within ~45 m.</div>
      <div v-for="p in nearby" :key="p.id" class="flex items-center justify-between gap-2 rounded-xl bg-ink/[0.04] px-2 py-1.5">
        <span class="truncate font-bold">@{{ p.name }} <span class="font-normal text-ink/45">{{ Math.round(p.d) }} m</span></span>
        <button class="shrink-0 rounded-full bg-emerald-600 px-2.5 py-0.5 font-bold text-white disabled:opacity-40" :disabled="party.seatsFree <= 0 || now - (sent[p.id] ?? 0) < 15000" @click="invite(p)">
          {{ now - (sent[p.id] ?? 0) < 15000 ? 'Sent' : 'Invite' }}
        </button>
      </div>
    </div>
  </div>
  <div v-else-if="party.role === 'passenger'" class="pointer-events-none absolute left-3 top-[9.75rem] z-20 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-ink shadow">
    🚗 Riding with {{ party.names[0] }} · E / Exit to get out
  </div>
</template>
