<script setup lang="ts">
// JobsPanel - available delivery jobs + my jobs with server-validated steps.
const player = usePlayerStore()
const ui = useUiStore()
const pos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const busy = ref('')

async function refresh() {
  try {
    player.jobs = await useGameApi().myJobs()
  } catch {
    /* ignore */
  }
}

onMounted(() => {
  refresh()
  useGameApi()
    .availableJobs()
    .then((jobs) => (available.value = jobs))
    .catch(() => {})
})

const available = ref<any[]>([])

async function loadAvailable() {
  try {
    available.value = await useGameApi().availableJobs()
  } catch {
    /* ignore */
  }
}

async function act(kind: 'accept' | 'pickup' | 'complete', job: any) {
  const api = useGameApi()
  busy.value = job.id + kind
  try {
    if (kind === 'accept') {
      await api.acceptJob(job.id)
      ui.showToast('Job accepted - head to the pickup point.', 'success')
    } else if (kind === 'pickup') {
      await api.pickupJob(job.id, [pos.value[0], pos.value[1], pos.value[2]])
      ui.showToast('Package picked up! Deliver it now.', 'success')
    } else {
      await api.completeJob(job.id, [pos.value[0], pos.value[1], pos.value[2]])
      ui.showToast('Delivery complete - k-sats + reputation paid.', 'success')
    }
    await refresh()
    await loadAvailable()
  } catch (e: any) {
    ui.showToast(e.message || 'Job action failed', 'error')
  } finally {
    busy.value = ''
  }
}

function fmtKsats(minor: number) {
  return `${Math.round(minor).toLocaleString('en')} ks`
}
</script>

<template>
  <div class="pointer-events-auto absolute right-3 top-20 z-30 w-[min(400px,92vw)] kk-panel kk-scroll max-h-[76vh] overflow-y-auto p-4 sm:right-4">
    <div class="mb-3 flex items-center justify-between">
      <div class="font-display text-base font-semibold text-ink">🧾 Jobs</div>
      <button class="kk-close" aria-label="Close" @click="ui.open('jobs')">✕</button>
    </div>

    <div class="text-[11px] font-bold uppercase tracking-widest text-ink/40">My jobs</div>
    <div v-if="player.jobs.length === 0" class="py-2 text-sm text-ink/50">No active jobs yet.</div>
    <div v-for="j in player.jobs" :key="j.id" class="mb-2 rounded-2xl border border-ink/10 bg-paper p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-extrabold text-ink">{{ j.title }}</div>
        <span class="kk-chip" :class="j.status === 'completed' ? 'text-leaf' : 'text-golddark'">{{ j.status }}</span>
      </div>
      <div class="mt-1 text-[11px] text-ink/50">
        Reward: <b class="text-golddark">{{ fmtKsats(j.reward_ksats) }} sim</b> + {{ j.reward_reputation }} rep ·
        {{ j.pickup_entity?.name }} → {{ j.dropoff_entity?.name }}
      </div>
      <div class="mt-2 flex gap-2" v-if="j.status !== 'completed'">
        <button
          v-if="j.status === 'assigned'"
          class="kk-btn-primary !px-3.5 !py-2 text-xs"
          :disabled="busy === j.id + 'pickup'"
          @click="act('pickup', j)"
        >
          📦 Pick up (be at {{ j.pickup_entity?.name }})
        </button>
        <button
          v-if="j.status === 'in_progress'"
          class="kk-btn-primary !px-3.5 !py-2 text-xs"
          :disabled="busy === j.id + 'complete'"
          @click="act('complete', j)"
        >
          ✅ Deliver (be at {{ j.dropoff_entity?.name }})
        </button>
      </div>
    </div>

    <div class="mt-4 flex items-center justify-between">
      <div class="text-[11px] font-bold uppercase tracking-widest text-ink/40">Job board</div>
      <button class="kk-btn-ghost !px-2 !py-0.5 text-[11px]" @click="loadAvailable">↻</button>
    </div>
    <div v-if="available.length === 0" class="py-2 text-sm text-ink/50">
      No open jobs right now - ask Musa, he posts delivery work when stock moves.
    </div>
    <div v-for="j in available" :key="j.id" class="mb-2 rounded-2xl border border-kasand/30 bg-kasand/10 p-3">
      <div class="text-sm font-extrabold text-ink">{{ j.title }}</div>
      <div class="mt-1 text-[11px] text-ink/55">{{ j.description }}</div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-xs font-bold text-golddark">💰 {{ fmtKsats(j.reward_ksats) }} sim + {{ j.reward_reputation }} rep</span>
        <button class="kk-btn-primary !px-3.5 !py-2 text-xs" :disabled="busy === j.id + 'accept'" @click="act('accept', j)">
          Accept
        </button>
      </div>
    </div>
  </div>
</template>
