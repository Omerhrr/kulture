<script setup lang="ts">
// Phone → Crews: start or join a crew (up to 20), chat with your crew in
// real time, and fight for night-race turf - a route belongs to the crew of
// whoever holds its best time. Members can meet at the crew clubhouse.
import { fmtNgn } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
const player = usePlayerStore()
const d = ref<any>(null)
const text = ref('')
const form = reactive({ name: '', tag: '', color: '#e0a020' })
const busy = ref(false)
const box = ref<HTMLElement | null>(null)

async function load() {
  try {
    d.value = await api.apiGet<any>('/crews')
    nextTick(() => box.value && (box.value.scrollTop = 1e6))
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
function onWs(ev: Event) {
  const m = (ev as CustomEvent).detail
  if (m?.type === 'social.crew' && d.value?.mine) {
    d.value.messages.push(m.payload)
    nextTick(() => box.value && (box.value.scrollTop = 1e6))
  }
}
onMounted(() => {
  load()
  window.addEventListener('kk-ws', onWs)
  ;(window as any).__kk_phone_page = 'crews'
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-ws', onWs)
  ;(window as any).__kk_phone_page = null
})
async function run(fn: () => Promise<any>, ok?: string) {
  busy.value = true
  try {
    await fn()
    if (ok) ui.showToast(ok, 'success')
    await load()
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
async function say() {
  const t = text.value.trim()
  if (!t) return
  text.value = ''
  try {
    const r = await api.apiPost<any>('/crews/say', { text: t })
    d.value.messages.push(r.message)
    nextTick(() => box.value && (box.value.scrollTop = 1e6))
  } catch (e: any) {
    ui.showToast(e.message, 'error')
  }
}
const ROUTE_NAMES: Record<string, string> = {}
const fmtMs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`
function clubhouse() {
  window.dispatchEvent(new CustomEvent('kk-clubhouse'))
  useState<boolean>('kk_phone_open').value = false
}
</script>

<template>
  <div v-if="d" class="space-y-2 text-ink">
    <!-- my crew -->
    <template v-if="d.mine">
      <div class="rounded-2xl p-3 text-white" :style="{ background: d.mine.color }">
        <div class="text-[15px] font-bold">[{{ d.mine.tag }}] {{ d.mine.name }}</div>
        <div class="text-[11px] font-semibold opacity-90">{{ d.mine.members.length }} members · {{ d.mine.members.map((m: any) => m.name).join(', ') }}</div>
        <div class="mt-2 flex gap-1">
          <button class="rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-bold" @click="clubhouse">🏠 Clubhouse</button>
          <button class="rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-bold" :disabled="busy" @click="run(() => api.apiPost('/crews/leave'), 'You left the crew')">Leave</button>
        </div>
      </div>
      <div ref="box" class="kk-scroll max-h-48 space-y-1 overflow-y-auto rounded-2xl bg-ink/[0.03] p-2">
        <div v-if="!d.messages.length" class="p-2 text-center text-[11px] text-ink/45">No messages yet - say sannu!</div>
        <div v-for="(m, i) in d.messages" :key="i" class="text-[12px]" :class="m.from === player.profile?.id ? 'text-right' : ''">
          <span class="inline-block max-w-[85%] rounded-2xl px-2.5 py-1" :class="m.from === player.profile?.id ? 'bg-violet-600 text-white' : 'bg-white'"><b v-if="m.from !== player.profile?.id" class="text-[10px]">{{ m.name }} </b>{{ m.text }}</span>
        </div>
      </div>
      <form class="flex gap-1" @submit.prevent="say">
        <input v-model="text" maxlength="400" placeholder="Message your crew…" class="min-w-0 flex-1 rounded-full border border-ink/10 px-3 py-1.5 text-xs" />
        <button class="rounded-full bg-violet-600 px-3 text-xs font-bold text-white">Send</button>
      </form>
    </template>

    <!-- turf -->
    <div class="rounded-2xl bg-ink/[0.04] p-3">
      <div class="text-xs font-bold">🏁 Night-race turf</div>
      <div v-if="!Object.keys(d.turf).length" class="text-[10px] text-ink/50">No crew holds a route yet. Set a best time in Phone → Races to claim one.</div>
      <div v-for="(t, r) in d.turf" :key="r" class="mt-1 flex items-center justify-between text-[11px]">
        <span class="font-semibold">{{ ROUTE_NAMES[String(r)] ?? String(r).replace(/_/g, ' ') }}</span>
        <span class="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" :style="{ background: t.color }">[{{ t.tag }}] {{ fmtMs(t.ms) }}</span>
      </div>
    </div>

    <!-- join / create -->
    <template v-if="!d.mine">
      <div class="text-xs font-bold">Crews</div>
      <div v-if="!d.crews.length" class="text-[11px] text-ink/50">No crews yet - start the first one.</div>
      <div v-for="c in d.crews" :key="c.id" class="flex items-center justify-between rounded-2xl bg-ink/[0.04] p-2.5 text-xs">
        <div><span class="mr-1 inline-block h-2.5 w-2.5 rounded-full" :style="{ background: c.color }" /><b>[{{ c.tag }}]</b> {{ c.name }} <span class="text-ink/45">· {{ c.members.length }}</span></div>
        <button class="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white" :disabled="busy" @click="run(() => api.apiPost(`/crews/${c.id}/join`), `Welcome to ${c.name}!`)">Join</button>
      </div>
      <form class="space-y-1.5 rounded-2xl bg-amber-50 p-3" @submit.prevent="run(() => api.apiPost('/crews', form), 'Crew created 🎉')">
        <div class="text-xs font-bold text-amber-800">Start a crew · {{ fmtNgn(d.fee) }}</div>
        <input v-model="form.name" maxlength="40" placeholder="Crew name (e.g. Barnawa Night Riders)" class="w-full rounded-full border border-ink/10 px-3 py-1 text-xs" />
        <div class="flex gap-1">
          <input v-model="form.tag" maxlength="5" placeholder="TAG" class="w-20 rounded-full border border-ink/10 px-3 py-1 text-xs uppercase" />
          <button v-for="c in ['#e0a020', '#2e7d5b', '#c0392b', '#3f6fae', '#8e44ad']" :key="c" type="button" class="h-6 w-6 rounded-full border-2" :class="form.color === c ? 'border-ink' : 'border-transparent'" :style="{ background: c }" @click="form.color = c" />
        </div>
        <button class="w-full rounded-full bg-amber-500 py-1.5 text-xs font-bold text-white" :disabled="busy">Create</button>
      </form>
    </template>
  </div>
  <div v-else class="p-4 text-center text-xs text-ink/50">Loading…</div>
</template>
