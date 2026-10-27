<script setup lang="ts">
// ObjectiveTracker - the story card ("Musa's Promise", stores/story): the
// chapter you're on, what to do next, and a live distance + arrow (relative
// to the camera) to the person or place. At the pickup / drop-off the card
// does the job step itself (the server checks you're really there).
// Collapses to a pill and can be hidden.
import { CAST } from '~/utils/cast'
import { fmtKsats } from '~/utils/format'
import { useStoryStore } from '~/stores/story'

const player = usePlayerStore()
const world = useWorldStore()
const ui = useUiStore()
const story = useStoryStore()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const orbit = useCamOrbit()
const ride = useRide()

const collapsed = ref(false)
const hidden = ref(false)
const busy = ref(false)

onMounted(() => {
  try {
    hidden.value = localStorage.getItem('kk_obj_hidden') === '1'
    // short landscape phones: start as a pill so it doesn't cover the world
    collapsed.value = window.innerHeight < 500 || window.innerWidth < 640
  } catch {}
  story.refresh()
})
// a job moved (picked up, delivered): the story may have moved with it
watch(
  () => player.jobs.map((j: any) => `${j.id}:${j.status}`).join(),
  () => story.refresh()
)
// the last chapter ends when you open a shop (Phone → Business) and moves
// with your savings: check now and then while you're on it
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => (poll = setInterval(() => story.s?.step === 'business' && story.refresh(), 12000)))
onBeforeUnmount(() => poll && clearInterval(poll))

const entity = (code: string | null | undefined) => (code ? world.entities.find((e) => e.code === code) : undefined)
const who = (code: string | null | undefined) => (code ? CAST[code] : undefined)

const s = computed(() => story.s)
const card = computed(() => {
  const st = s.value
  if (!st) return null
  const place = entity(st.target)?.name ?? ''
  switch (st.step) {
    case 'talk': {
      const p = who(st.target)
      return { title: `Talk to ${p?.name ?? 'them'}`, hint: `${p?.role ?? place}. Walk up and press E.` }
    }
    case 'pickup':
      return { title: `Collect ${st.parcel}`, hint: `At ${place}.` }
    case 'deliver': {
      const r = who(st.receiver)
      return { title: `Deliver to ${r?.name ?? place}`, hint: r ? `${r.role}.` : `${place}.` }
    }
    case 'business': {
      const need = st.need_ksats ?? 0
      const have = st.have_ksats ?? 0
      const hint = !st.ready
        ? 'First move out: Phone → Life → Rent a flat. Then Phone → Business.'
        : have < need
          ? `Save up: ${fmtKsats(have)} of ${fmtKsats(need)}. Work shifts (Phone → Work).`
          : 'You can afford it. Phone → Business → open your shop.'
      return { title: 'Open your own shop', hint }
    }
    default:
      return { title: 'Kaduna is yours', hint: st.summary }
  }
})

// live distance + bearing to the target
const nav = computed(() => {
  const e = entity(s.value?.target)
  if (!e || !Number.isFinite(playerPos.value[0])) return null
  const dx = e.position[0] - playerPos.value[0]
  const dz = e.position[2] - playerPos.value[2]
  const d = Math.hypot(dx, dz)
  // screen-relative angle: camera looks along -(sin yaw, cos yaw)
  const bearing = Math.atan2(dx, dz)
  const camFwd = Math.atan2(-Math.sin(orbit.value.yaw), -Math.cos(orbit.value.yaw))
  return { d, deg: (-(bearing - camFwd) * 180) / Math.PI, here: d < Math.max(8, e.interaction_radius ?? 8) }
})
const distLabel = computed(() => {
  const d = nav.value?.d ?? 0
  if (d < 12) return 'here'
  return d < 1000 ? `${Math.round(d / 5) * 5} m` : `${(d / 1000).toFixed(1)} km`
})
const progress = computed(() => (s.value ? Math.min(s.value.chapter, s.value.total) : 0))

// at the pickup / drop-off: do the job step from the card
const action = computed(() => {
  const st = s.value
  if (!st?.job_id || !nav.value?.here || ride.value.active) return null
  if (st.step === 'pickup') return { kind: 'pickup' as const, label: '📦 Pick up' }
  if (st.step === 'deliver') return { kind: 'complete' as const, label: '✅ Deliver' }
  return null
})
async function act() {
  const a = action.value
  const id = s.value?.job_id
  if (!a || !id || busy.value) return
  busy.value = true
  const api = useGameApi()
  const p: [number, number, number] = [playerPos.value[0], playerPos.value[1], playerPos.value[2]]
  try {
    if (a.kind === 'pickup') await api.pickupJob(id, p)
    else await api.completeJob(id, p)
    player.jobs = await api.myJobs()
    await story.refresh()
    if (a.kind === 'pickup') ui.showToast('Got it. Now deliver it.', 'success')
  } catch (e: any) {
    ui.showToast(e.message || 'Not here', 'error')
  } finally {
    busy.value = false
  }
}

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
  <div v-if="s && card" class="pointer-events-auto">
    <button v-if="hidden" class="kk-btn-ghost !px-3 !py-1.5 text-xs" @click="reset">📖 Story</button>
    <div v-else-if="collapsed" class="kk-panel flex cursor-pointer items-center gap-2 px-3 py-2" @click="collapsed = false">
      <span class="text-xs font-extrabold text-kadeep">{{ s.done ? '✓' : `${s.chapter + 1}/${s.total}` }}</span>
      <span class="max-w-[12rem] truncate text-xs font-bold text-ink">{{ card.title }}</span>
      <span v-if="nav" class="text-xs font-bold text-ink/50">{{ distLabel }}</span>
    </div>
    <div v-else class="kk-panel w-[min(300px,80vw)] p-3.5">
      <div class="mb-1.5 flex items-center justify-between">
        <div class="text-[10px] font-extrabold uppercase tracking-[0.14em] text-kadeep/70">
          {{ s.done ? "Musa's Promise · complete" : `Chapter ${s.chapter + 1} of ${s.total} · ${s.title}` }}
        </div>
        <div class="flex gap-1">
          <button class="rounded-full px-1.5 text-xs text-ink/40 hover:text-ink" title="Minimise" @click="collapsed = true">-</button>
          <button class="rounded-full px-1.5 text-xs text-ink/40 hover:text-ink" title="Hide story card" @click="dismiss">✕</button>
        </div>
      </div>
      <!-- progress bar -->
      <div class="mb-2.5 flex gap-1">
        <div v-for="n in s.total" :key="n" class="h-1 flex-1 rounded-full" :class="n <= progress ? 'bg-leaf' : n === progress + 1 ? 'bg-gold' : 'bg-ink/10'" />
      </div>
      <div class="font-display text-[15px] font-semibold leading-snug text-ink">{{ card.title }}</div>
      <p class="mt-1 text-xs leading-relaxed text-ink/60">{{ card.hint }}</p>
      <div v-if="s.step === 'business' && s.need_ksats" class="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div class="h-full rounded-full bg-leaf" :style="{ width: `${Math.min(100, ((s.have_ksats ?? 0) / s.need_ksats) * 100)}%` }" />
      </div>
      <div v-if="nav" class="mt-2.5 flex items-center gap-2.5 rounded-xl bg-paper px-2.5 py-1.5">
        <div class="flex h-7 w-7 items-center justify-center rounded-full bg-kadeep text-white">
          <span class="inline-block text-sm leading-none" :style="{ transform: `rotate(${nav.deg}deg)` }">↑</span>
        </div>
        <div class="flex-1 text-xs">
          <span class="font-extrabold text-ink">{{ distLabel }}</span>
          <span class="ml-1 text-ink/50">{{ nav.d < 12 ? '- you are there' : ride.active ? 'away - keep driving' : 'away' }}</span>
        </div>
        <button v-if="action" class="kk-btn-primary !px-3 !py-1 text-xs" :disabled="busy" @click="act">{{ action.label }}</button>
      </div>
    </div>
  </div>
</template>
