<script setup lang="ts">
// CityMap - the live 3D city from above (like Lagos Life's map). The camera
// tilts over the real city; HTML bubbles float over places, work, public
// buildings, billboards and other players. Drag to pan, scroll/pinch to
// zoom, chips filter layers, tap a bubble for actions (ride there, walk,
// view ads). Bubbles are positioned imperatively every frame (no reactivity
// churn) using the canvas camera published by MapProjector.
import { BAKE } from '~/utils/kaduna'
import { BILLBOARDS } from '~/utils/billboards'
import { project } from '~/utils/mapProject'
import { useWorkStore } from '~/stores/work'
import { useAdsStore } from '~/stores/ads'
import { useCityMap, useMapOpen, useMoveTarget } from '~/composables/useControlsState'

const cm = useCityMap()
const flatMap = useMapOpen()
const moveTarget = useMoveTarget()
const world = useWorldStore()
const work = useWorkStore()
const ads = useAdsStore()
const playerPos = useState<[number, number, number]>('kk_player_pos')
const homeDoor = useState<[number, number] | null>('kk_home_door', () => null)
const players = useState<{ online: number; players: any[] }>('kk_players', () => ({ online: 0, players: [] }))

type Layer = 'places' | 'work' | 'civic' | 'billboards' | 'neighbours' | 'names'
const CHIPS: Array<{ id: Layer; icon: string; label: string }> = [
  { id: 'neighbours', icon: '🟢', label: 'Neighbours' },
  { id: 'places', icon: '📍', label: 'Places' },
  { id: 'work', icon: '💼', label: 'Work' },
  { id: 'civic', icon: '🏥', label: 'Services' },
  { id: 'billboards', icon: '📢', label: 'Billboards' },
  { id: 'names', icon: '🏷️', label: 'Names' }
]
const on = reactive<Record<Layer, boolean>>({ neighbours: true, places: true, work: true, civic: true, billboards: true, names: false })

interface Poi {
  id: string
  layer: Layer | 'me' | 'home'
  icon: string
  label: string
  sub: string
  x: number
  z: number
  y: number
  code?: string
  board?: string
  player?: boolean
}
const ENT_ICON: Record<string, string> = { shop: '🏪', market: '🧺', landmark: '🏛️', transport_stop: '🛺', pos_kiosk: '⚡' }
const CIVIC: Record<string, [string, string]> = { hospital: ['🏥', 'Hospital'], school: ['🏫', 'School'], fuel: ['⛽', 'Filling station'], mechanic: ['🔧', 'Mechanic'] }

const pois = computed<Poi[]>(() => {
  const out: Poi[] = []
  const workCodes = new Set(work.careers.map((c) => c.place_code))
  for (const e of world.entities) {
    if (!e.is_active || e.entity_type === 'npc' || e.entity_type === 'spawn') continue
    const isWork = workCodes.has(e.code)
    const career = work.careers.find((c) => c.place_code === e.code)
    out.push({ id: 'e:' + e.code, layer: isWork ? 'work' : 'places', icon: isWork ? '💼' : ENT_ICON[e.entity_type] ?? '📍', label: e.name, sub: career ? `${career.title} · ${career.pay_ksats.toLocaleString()} ks a shift` : e.entity_type.replace('_', ' '), x: e.position[0], z: e.position[2], y: 6, code: e.code })
  }
  for (const [i, c] of (BAKE.civic ?? []).entries()) {
    const [icon, label] = CIVIC[c.kind] ?? ['🏢', c.kind]
    out.push({ id: 'c:' + i, layer: 'civic', icon, label, sub: 'Public service', x: c.x, z: c.z, y: 8 })
  }
  void ads.version
  for (const b of BILLBOARDS) {
    const n = ads.boards[b.id]?.length ?? 0
    out.push({ id: 'b:' + b.id, layer: 'billboards', icon: '📢', label: `Billboard ${Number(b.id.slice(3)) + 1}`, sub: `${b.road} · ${n ? `${n} ad${n > 1 ? 's' : ''} on air` : 'free to book'}`, x: b.x, z: b.z, y: 10, board: b.id })
  }
  for (const p of players.value.players) out.push({ id: 'p:' + p.id, layer: 'neighbours', icon: '🙂', label: '@' + p.name, sub: p.riding ? 'Riding' : p.moving ? 'Moving' : 'Hanging around', x: p.pos[0], z: p.pos[2], y: 3, player: true })
  for (const [i, p] of BAKE.places.entries()) out.push({ id: 'n:' + i, layer: 'names', icon: '', label: p.name, sub: 'Neighbourhood', x: p.x, z: p.z, y: 2 })
  if (homeDoor.value) out.push({ id: 'home', layer: 'home', icon: '🏠', label: 'Your home', sub: 'Fridge, bed, shower', x: homeDoor.value[0], z: homeDoor.value[1], y: 6 })
  out.push({ id: 'me', layer: 'me', icon: '', label: 'You', sub: '', x: playerPos.value[0], z: playerPos.value[2], y: 2 })
  return out
})
const visible = computed(() => pois.value.filter((p) => p.layer === 'me' || p.layer === 'home' || on[p.layer as Layer]))

// ------------------------------------------------------------ positioning
const els = new Map<string, HTMLElement>()
const setEl = (id: string) => (el: any) => (el ? els.set(id, el as HTMLElement) : els.delete(id))
let raf = 0
function frame() {
  raf = requestAnimationFrame(frame)
  if (!cm.value.active) return
  const maxD = cm.value.dist * 1.7
  for (const p of visible.value) {
    const el = els.get(p.id)
    if (!el) continue
    const far = Math.hypot(p.x - cm.value.fx, p.z - cm.value.fz) > maxD
    const s = far ? null : project(p.x, p.y, p.z)
    if (!s) {
      el.style.display = 'none'
      continue
    }
    el.style.display = ''
    el.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%, -100%)`
  }
}
onMounted(() => (raf = requestAnimationFrame(frame)))
onBeforeUnmount(() => cancelAnimationFrame(raf))

// ------------------------------------------------------------ pan / zoom
let drag: { x: number; y: number; id: number } | null = null
const pointers = new Map<number, { x: number; y: number }>()
let pinch0 = 0
function down(e: PointerEvent) {
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinch0 = Math.hypot(a.x - b.x, a.y - b.y)
  }
}
function move(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinch0) zoom(pinch0 / d)
    pinch0 = d
    return
  }
  if (!drag || drag.id !== e.pointerId) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  drag.x = e.clientX
  drag.y = e.clientY
  // screen drag -> ground pan, scaled by zoom, rotated by the map yaw
  const k = cm.value.dist / 520
  const yw = cm.value.yaw
  const rx = Math.cos(yw)
  const rz = -Math.sin(yw)
  const fx = -Math.sin(yw)
  const fz = -Math.cos(yw)
  cm.value.fx -= (dx * rx - dy * fx) * k
  cm.value.fz -= (dx * rz - dy * fz) * k
}
function up(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (drag?.id === e.pointerId) drag = null
  if (pointers.size < 2) pinch0 = 0
}
function zoom(f: number) {
  cm.value.dist = Math.max(90, Math.min(1500, cm.value.dist * f))
}
function recenter() {
  cm.value.fx = playerPos.value[0]
  cm.value.fz = playerPos.value[2]
}

// ------------------------------------------------------------ selection
const sel = ref<Poi | null>(null)
const selDist = computed(() => {
  if (!sel.value) return ''
  const d = Math.hypot(sel.value.x - playerPos.value[0], sel.value.z - playerPos.value[2])
  return d < 1000 ? `${Math.round(d / 10) * 10} m away` : `${(d / 1000).toFixed(1)} km away`
})
function pick(p: Poi) {
  if (p.layer === 'me') return
  sel.value = p
}
function close() {
  cm.value.active = false
  sel.value = null
}
function ride() {
  const p = sel.value!
  close()
  if (p.layer === 'home') return window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'home' } }))
  window.dispatchEvent(new CustomEvent('kk-commute', { detail: { dest: 'place', place: { code: p.code, name: p.label, to: [p.x + 4, p.z + 4] } } }))
}
function walk() {
  const p = sel.value!
  close()
  moveTarget.value = { x: p.x + 3, z: p.z + 3 }
}
function viewAds() {
  const b = sel.value!.board!
  close()
  ads.open(b)
}
function flat() {
  close()
  flatMap.value = true
}
watch(
  () => cm.value.active,
  (a) => {
    if (a) {
      recenter()
      work.refresh().catch(() => {})
      ads.refresh().catch(() => {})
    }
  }
)
</script>

<template>
  <div v-if="cm.active" class="pointer-events-auto absolute inset-0 z-30 touch-none select-none" @pointerdown.self="down" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel.prevent="zoom($event.deltaY > 0 ? 1.12 : 0.89)">
    <!-- bubbles -->
    <template v-for="p in visible" :key="p.id">
      <div :ref="setEl(p.id)" class="absolute left-0 top-0 will-change-transform" style="display: none">
        <div v-if="p.layer === 'me'" class="flex flex-col items-center">
          <span class="rounded-full bg-leaf px-2.5 py-1 text-xs font-extrabold text-white shadow-lg">You</span>
          <span class="mt-0.5 h-3 w-3 rounded-full border-2 border-white bg-leaf shadow" />
        </div>
        <span v-else-if="p.layer === 'names'" class="pointer-events-none whitespace-nowrap text-sm font-extrabold uppercase tracking-wider text-white/90 [text-shadow:0_1px_4px_rgba(0,0,0,.6)]">{{ p.label }}</span>
        <button v-else class="group flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 py-1 pl-1 pr-3 text-[13px] font-bold text-ink shadow-lg ring-2 transition hover:scale-105" :class="sel?.id === p.id ? 'ring-leaf' : 'ring-transparent'" @pointerdown.stop @click.stop="pick(p)">
          <span class="flex h-7 w-7 items-center justify-center rounded-full text-base" :class="p.player ? 'bg-sky-100' : p.layer === 'billboards' ? 'bg-rose-100' : p.layer === 'work' ? 'bg-emerald-100' : 'bg-paper'">{{ p.icon }}</span>
          <span class="max-w-[9rem] truncate">{{ p.label }}</span>
        </button>
      </div>
    </template>

    <!-- chips -->
    <div class="pointer-events-none absolute inset-x-0 top-[4.6rem] flex justify-center px-3">
      <div class="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/90 p-1.5 shadow-xl backdrop-blur" @pointerdown.stop>
        <button v-for="c in CHIPS" :key="c.id" class="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-bold transition-colors" :class="on[c.id] ? 'bg-sky-500 text-white' : 'text-ink/70 hover:bg-ink/5'" :aria-pressed="on[c.id]" @click="on[c.id] = !on[c.id]">
          <span aria-hidden="true">{{ c.icon }}</span>{{ c.label }}
        </button>
      </div>
    </div>

    <!-- map controls -->
    <div class="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2 sm:right-4" @pointerdown.stop>
      <button class="kk-close h-11 w-11 bg-white text-lg shadow-lg" aria-label="Zoom in" @click="zoom(0.75)">＋</button>
      <button class="kk-close h-11 w-11 bg-white text-lg shadow-lg" aria-label="Zoom out" @click="zoom(1.33)">−</button>
      <button class="kk-close h-11 w-11 bg-white text-lg shadow-lg" title="Back to you" aria-label="Back to you" @click="recenter">◎</button>
      <button class="kk-close h-11 w-11 bg-white text-xs font-extrabold shadow-lg" title="Flat map" aria-label="Flat map" @click="flat">2D</button>
      <button class="kk-close h-11 w-11 bg-white text-lg shadow-lg" aria-label="Close map" @click="close">✕</button>
    </div>

    <!-- selection card -->
    <transition enter-active-class="transition duration-200" enter-from-class="translate-y-4 opacity-0">
      <div v-if="sel" class="absolute inset-x-0 bottom-28 flex justify-center px-3" @pointerdown.stop>
        <div class="kk-panel w-[min(440px,94vw)] p-4">
          <div class="flex items-start gap-3">
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-paper text-2xl">{{ sel.icon || '📍' }}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate font-display text-lg font-semibold text-ink">{{ sel.label }}</div>
              <div class="truncate text-sm capitalize text-ink/55">{{ sel.sub }}</div>
              <div class="text-xs font-bold text-ink/40">{{ selDist }}</div>
            </div>
            <button class="kk-close" aria-label="Close" @click="sel = null">✕</button>
          </div>
          <div class="mt-3 flex gap-2">
            <button v-if="sel.board" class="flex-1 rounded-full bg-rose-500 py-3 font-bold text-white hover:bg-rose-600" @click="viewAds">📢 View ads</button>
            <button v-if="!sel.player" class="flex-1 rounded-full bg-leaf py-3 font-bold text-white hover:bg-kadeep" @click="ride">🚕 Ride there</button>
            <button class="flex-1 rounded-full bg-ink/5 py-3 font-bold text-ink hover:bg-ink/10" @click="walk">🚶 Walk</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>
