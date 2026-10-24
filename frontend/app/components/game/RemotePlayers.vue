<script setup lang="ts">
// RemotePlayers - everyone else who is online near you. The server streams a
// 1 Hz snapshot of nearby players (positions it already accepted); we glide
// each avatar toward its latest position and float an @name tag above it.
import * as THREE from 'three'
import { vehicleSpec, paintedVehicle, vehicleMaterial, type VehicleKind } from '~/utils/vehicles'

// people already in your vehicle are drawn by RideSystem (seated, in sync)
const partyIds = useState<string[]>('kk_ride_party_ids', () => [])
const KINDS = ['car', 'keke', 'okada', 'bus', 'truck', 'bicycle', 'boat', 'plane']
/** "kind|driver|seat|colour" (or a bare kind from a commute) */
interface RideInfo {
  kind: VehicleKind
  driver: string
  seat: number
  color: string
}
function parseRiding(r: string | null, self: string): RideInfo | null {
  if (!r) return null
  const [kind, driver, seat, color] = r.split('|')
  if (!KINDS.includes(kind!)) return null
  return { kind: kind as VehicleKind, driver: driver || self, seat: seat ? Number(seat) : -1, color: color || '' }
}
const vehRoot = new THREE.Group()
const vehMat = vehicleMaterial()
const vehicles = new Map<string, { key: string; group: THREE.Group }>()

interface Remote {
  id: string
  name: string
  pos: [number, number, number]
  facing: number
  look: Record<string, string>
  moving: boolean
  riding: string | null
}
const snap = useState<{ online: number; players: Remote[] }>('kk_players', () => ({ online: 0, players: [] }))

// displayed (interpolated) state per player
interface Shown {
  id: string
  name: string
  x: number
  z: number
  h: number
  tx: number
  tz: number
  th: number
  moving: boolean
  look: Record<string, string>
  lookKey: string
  tag: THREE.CanvasTexture
  tagW: number
  action: string | null
  actionKey: number
  ride: RideInfo | null
  /** avatar placement (seated in a vehicle, or standing at x/z) */
  ax: number
  ay: number
  seatH: number
  az: number
  ah: number
}
const shown = ref<Shown[]>([])

const tags = new Map<string, { tex: THREE.CanvasTexture; w: number }>()
function tagFor(name: string) {
  const hit = tags.get(name)
  if (hit) return hit
  const text = '@' + name
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = '700 44px Nunito, system-ui, sans-serif'
  const w = Math.ceil(g.measureText(text).width) + 48
  c.width = w
  c.height = 72
  g.font = '700 44px Nunito, system-ui, sans-serif'
  g.fillStyle = '#2f6fe0'
  g.beginPath()
  g.roundRect(2, 4, w - 4, 64, 32)
  g.fill()
  g.fillStyle = '#ffffff'
  g.textBaseline = 'middle'
  g.fillText(text, 24, 38)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const out = { tex, w: w / 72 }
  tags.set(name, out)
  return out
}

watch(
  () => snap.value.players,
  (list) => {
    const byId = new Map<string, Shown>(shown.value.map((s) => [s.id, s] as [string, Shown]))
    const next: Shown[] = []
    for (const p of list) {
      const cur = byId.get(p.id)
      const lookKey = JSON.stringify(p.look)
      if (cur) {
        cur.tx = p.pos[0]
        cur.tz = p.pos[2]
        cur.th = p.facing
        cur.moving = p.moving
        cur.ride = parseRiding(p.riding, p.id)
        if (cur.name !== p.name) {
          const t = tagFor(p.name)
          cur.name = p.name
          cur.tag = t.tex
          cur.tagW = t.w
        }
        if (cur.lookKey !== lookKey) {
          cur.look = p.look
          cur.lookKey = lookKey
        }
        // far jump (fast travel): snap instead of sliding across town
        if (Math.hypot(cur.tx - cur.x, cur.tz - cur.z) > 60) {
          cur.x = cur.tx
          cur.z = cur.tz
        }
        next.push(cur)
      } else {
        const t = tagFor(p.name)
        next.push({ id: p.id, name: p.name, x: p.pos[0], z: p.pos[2], h: p.facing, tx: p.pos[0], tz: p.pos[2], th: p.facing, moving: p.moving, look: p.look, lookKey, tag: t.tex, tagW: t.w, action: null, actionKey: 0, ride: parseRiding(p.riding, p.id), ax: p.pos[0], ay: 0, seatH: 0.5, az: p.pos[2], ah: p.facing })
      }
    }
    shown.value = next
  }
)

function onEmote(e: Event) {
  const d = (e as CustomEvent).detail as { id: string; action: string }
  const s = shown.value.find((x) => x.id === d.id)
  if (s) {
    s.action = d.action
    s.actionKey++
  }
}
onMounted(() => window.addEventListener('kk-remote-emote', onEmote))
onBeforeUnmount(() => window.removeEventListener('kk-remote-emote', onEmote))

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  const k = Math.min(1, (delta || 0.016) * 4)
  for (const s of shown.value) {
    s.x += (s.tx - s.x) * k
    s.z += (s.tz - s.z) * k
    let dh = s.th - s.h
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    s.h += dh * k
  }
  // vehicles: one per remote driver (not the one you are riding in)
  const keep = new Set<string>()
  const byId = new Map<string, Shown>(shown.value.map((x: Shown) => [x.id, x] as [string, Shown]))
  for (const s of shown.value) {
    const r = s.ride
    if (!r || r.driver !== s.id || partyIds.value.includes(s.id)) continue
    const key = `${r.kind}${r.color}`
    let v = vehicles.get(s.id)
    if (!v || v.key !== key) {
      if (v) vehRoot.remove(v.group)
      v = { key, group: paintedVehicle(r.kind, r.color || undefined, vehMat).group }
      vehicles.set(s.id, v)
      vehRoot.add(v.group)
    }
    v.group.position.set(s.x, 0, s.z)
    v.group.rotation.y = s.h
    keep.add(s.id)
  }
  for (const [id, v] of vehicles) if (!keep.has(id)) (vehRoot.remove(v.group), vehicles.delete(id))
  // seat everyone who is riding (passengers sit in their driver's vehicle)
  for (const s of shown.value) {
    const r = s.ride
    if (!r) {
      s.ax = s.x
      s.ay = 0
      s.az = s.z
      s.ah = s.h
      continue
    }
    const d = byId.get(r.driver) ?? s
    const spec = vehicleSpec(r.kind)
    const o = r.seat >= 0 ? spec.passengers[r.seat] ?? spec.seat : spec.seat
    s.ax = d.x + Math.cos(d.h) * o[0] + Math.sin(d.h) * o[2]
    s.ay = 0
    s.seatH = o[1]
    s.az = d.z - Math.sin(d.h) * o[0] + Math.cos(d.h) * o[2]
    s.ah = d.h
  }
})
onBeforeUnmount(() => vehicles.clear())
if (import.meta.dev && typeof window !== 'undefined') (window as any).__kk_remotes = () => shown.value.map((s) => ({ name: s.name, x: +s.x.toFixed(1), z: +s.z.toFixed(1) }))
</script>

<template>
  <TresGroup>
    <primitive :object="vehRoot" />
    <TresGroup v-for="s in shown" :key="s.id" :visible="!partyIds.includes(s.id)" :position="[s.ax, s.ay, s.az]">
      <TresGroup :rotation="[0, s.ah, 0]">
        <CharacterAvatar real
          :key="s.lookKey"
          :shirt="s.look.top || '#3f6fae'"
          :trouser="s.look.bottom || '#2b3440'"
          :skin="s.look.skin || '#7a4e33'"
          :kufi="(s.look.hair || 'cap') === 'cap'"
          :hijab="s.look.outfit === 'dress'"
          :hair-style="(s.look.hair as any) || 'cap'"
          :hair-color="s.look.hairColor || '#141114'"
          :outfit="(s.look.outfit as any) || 'kaftan'"
          :beard="s.look.body !== 'woman' && s.look.hair !== 'braids'"
          :mode="s.ride ? 'sit' : s.moving ? 'walk' : 'idle'"
          :seat="s.seatH"
          :action="(s.action as any)"
          :action-key="s.actionKey"
        />
      </TresGroup>
      <TresSprite :position="[0, 2.35, 0]" :scale="[s.tagW * 0.42, 0.42, 1]" :render-order="10">
        <TresSpriteMaterial :map="s.tag" :transparent="true" :depth-write="false" />
      </TresSprite>
    </TresGroup>
  </TresGroup>
</template>
