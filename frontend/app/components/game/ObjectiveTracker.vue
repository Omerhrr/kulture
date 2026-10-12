<script setup lang="ts">
// ObjectiveTracker - the "what do I do now?" card. Walks a first-time
// player (or a judge with two minutes) through the golden path:
// meet Musa -> take the delivery job -> pick up -> ride across town ->
// deliver -> pay with Lightning -> explore. Shows the live distance and a
// direction arrow (relative to the camera) to the next place.
// Progress comes from authoritative server state (jobs, payments) plus a
// couple of local flags; it collapses to a pill and can be dismissed.
const player = usePlayerStore()
const world = useWorldStore()
const ui = useUiStore()
const payments = usePaymentsStore()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const orbit = useCamOrbit()
const ride = useRide()

const collapsed = ref(false)
const hidden = ref(false)
const talked = ref(false)
const paid = ref(false)

onMounted(() => {
  try {
    talked.value = localStorage.getItem('kk_obj_talked') === '1'
    paid.value = localStorage.getItem('kk_obj_paid') === '1'
    hidden.value = localStorage.getItem('kk_obj_hidden') === '1'
    // short landscape phones: start as a pill so it doesn't cover the world
    collapsed.value = window.innerHeight < 500 || window.innerWidth < 640
  } catch {}
})
watch(
  () => ui.dialogue,
  (d) => {
    if (d && /musa/i.test(d.npcName)) {
      talked.value = true
      try {
        localStorage.setItem('kk_obj_talked', '1')
      } catch {}
    }
  }
)
watch(
  () => payments.current?.status,
  (s) => {
    if (s === 'settled' || s === 'fulfilled') {
      paid.value = true
      try {
        localStorage.setItem('kk_obj_paid', '1')
      } catch {}
    }
  }
)

const entity = (code: string) => world.entities.find((e) => e.code === code)

interface Step {
  title: string
  hint: string
  target: string | null
}
const steps = computed<Step[]>(() => [
  { title: "Find Musa's Provision Store", hint: 'Across the street from where you start. Walk over with WASD.', target: 'musa_shop' },
  { title: 'Talk to Mallam Musa', hint: 'Stand next to him and press E. He is an AI shopkeeper.', target: 'npc_musa' },
  { title: 'Take a delivery job', hint: 'Ask Musa about delivery work, or open Jobs (J).', target: 'npc_musa' },
  { title: 'Pick up the package', hint: "Collect the sealed package at Musa's store.", target: 'musa_shop' },
  { title: 'Deliver to Hajiya Amina', hint: 'Stonetech Square is ~800 m south. Hop on the keke or car by the spawn (E).', target: 'npc_amina' },
  { title: 'Pay with Lightning ⚡', hint: "Back at Musa's: Browse, pick an item, pay the invoice in sats.", target: 'musa_shop' },
  { title: 'Kaduna is yours', hint: 'Enter any home (E at a gate), change the weather (Y), drive, ride an okada.', target: null }
])

const index = computed(() => {
  const jobs = player.jobs
  const active = jobs.find((j) => j.status === 'assigned' || j.status === 'in_progress')
  const done = jobs.some((j) => j.status === 'completed')
  const prox = useState<{ code: string } | null>('kk_proximity').value
  if (paid.value && done) return 6
  if (done) return paid.value ? 6 : 5
  if (active?.status === 'in_progress' || player.hasParcel) return 4
  if (active) return 3
  if (talked.value) return 2
  if (prox && (prox.code === 'musa_shop' || prox.code === 'npc_musa')) return 1
  return 0
})
const step = computed(() => steps.value[index.value])

// live distance + bearing to the target
const nav = computed(() => {
  const code = step.value.target
  if (!code) return null
  const e = entity(code)
  if (!e || !Number.isFinite(playerPos.value[0])) return null
  const dx = e.position[0] - playerPos.value[0]
  const dz = e.position[2] - playerPos.value[2]
  const d = Math.hypot(dx, dz)
  // screen-relative angle: camera looks along -(sin yaw, cos yaw)
  const world = Math.atan2(dx, dz)
  const camFwd = Math.atan2(-Math.sin(orbit.value.yaw), -Math.cos(orbit.value.yaw))
  const rel = world - camFwd
  return { d, deg: (-rel * 180) / Math.PI }
})
const distLabel = computed(() => {
  const d = nav.value?.d ?? 0
  if (d < 12) return 'here'
  return d < 1000 ? `${Math.round(d / 5) * 5} m` : `${(d / 1000).toFixed(1)} km`
})

function dismiss() {
  hidden.value = true
  try {
    localStorage.setItem('kk_obj_hidden', '1')
  } catch {}
}
function reset() {
  hidden.value = false
  collapsed.value = false
  try {
    localStorage.removeItem('kk_obj_hidden')
  } catch {}
}
defineExpose({ reset })
</script>

<template>
  <div class="pointer-events-auto">
    <button v-if="hidden" class="kk-btn-ghost !px-3 !py-1.5 text-xs" @click="reset">🎯 Guide</button>
    <div v-else-if="collapsed" class="kk-panel flex cursor-pointer items-center gap-2 px-3 py-2" @click="collapsed = false">
      <span class="text-xs font-extrabold text-kadeep">{{ Math.min(index + 1, 6) }}/6</span>
      <span class="max-w-[12rem] truncate text-xs font-bold text-ink">{{ step.title }}</span>
      <span v-if="nav" class="text-xs font-bold text-ink/50">{{ distLabel }}</span>
    </div>
    <div v-else class="kk-panel w-[min(300px,80vw)] p-3.5">
      <div class="mb-1.5 flex items-center justify-between">
        <div class="text-[10px] font-extrabold uppercase tracking-[0.14em] text-kadeep/70">
          {{ index < 6 ? `Step ${index + 1} of 6` : 'Free roam' }}
        </div>
        <div class="flex gap-1">
          <button class="rounded-full px-1.5 text-xs text-ink/40 hover:text-ink" title="Minimise" @click="collapsed = true">-</button>
          <button class="rounded-full px-1.5 text-xs text-ink/40 hover:text-ink" title="Hide guide" @click="dismiss">✕</button>
        </div>
      </div>
      <!-- progress bar -->
      <div class="mb-2.5 flex gap-1">
        <div v-for="n in 6" :key="n" class="h-1 flex-1 rounded-full" :class="n <= index ? 'bg-leaf' : n === index + 1 ? 'bg-gold' : 'bg-ink/10'" />
      </div>
      <div class="font-display text-[15px] font-semibold leading-snug text-ink">{{ step.title }}</div>
      <p class="mt-1 text-xs leading-relaxed text-ink/60">{{ step.hint }}</p>
      <div v-if="nav" class="mt-2.5 flex items-center gap-2.5 rounded-xl bg-paper px-2.5 py-1.5">
        <div class="flex h-7 w-7 items-center justify-center rounded-full bg-kadeep text-white">
          <span class="inline-block text-sm leading-none" :style="{ transform: `rotate(${nav.deg}deg)` }">↑</span>
        </div>
        <div class="text-xs">
          <span class="font-extrabold text-ink">{{ distLabel }}</span>
          <span class="ml-1 text-ink/50">{{ nav.d < 12 ? '- you are there' : ride.active ? 'away - keep driving' : 'away' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
