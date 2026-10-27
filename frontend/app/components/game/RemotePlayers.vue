<script setup lang="ts">
import { fromSimLook } from '~/utils/people'
// RemotePlayers - everyone else who is online near you. The server streams a
// few-times-a-second snapshot of nearby players (positions it already
// accepted). Each avatar walks at a steady speed from where it is shown to
// the new position over one snapshot gap, so motion is smooth instead of
// surging forward and easing off on every update. An @name tag floats above.
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
  /** interpolation: shown position when the latest snapshot arrived */
  fx: number
  fz: number
  fh: number
  t0: number
  dur: number
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
        // glide from wherever it is drawn now to the new spot over one gap
        const now = performance.now() / 1000
        cur.dur = Math.min(1.5, Math.max(0.12, now - cur.t0))
        cur.t0 = now
        cur.fx = cur.x
        cur.fz = cur.z
        cur.fh = cur.h
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
          cur.x = cur.fx = cur.tx
          cur.z = cur.fz = cur.tz
        }
        next.push(cur)
      } else {
        const t = tagFor(p.name)
        next.push({ id: p.id, name: p.name, x: p.pos[0], z: p.pos[2], h: p.facing, tx: p.pos[0], tz: p.pos[2], th: p.facing, moving: p.moving, look: p.look, lookKey, tag: t.tex, tagW: t.w, action: null, actionKey: 0, ride: parseRiding(p.riding, p.id), ax: p.pos[0], ay: 0, seatH: 0.5, az: p.pos[2], ah: p.facing, fx: p.pos[0], fz: p.pos[2], fh: p.facing, t0: performance.now() / 1000, dur: 0.25 })
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
  void delta
  const now = performance.now() / 1000
  for (const s of shown.value) {
    const t = Math.min(1, (now - s.t0) / s.dur)
    s.x = s.fx + (s.tx - s.fx) * t
    s.z = s.fz + (s.tz - s.fz) * t
    let dh = s.th - s.fh
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    s.h = s.fh + dh * Math.min(1, t * 1.6) // turn a little quicker than it walks
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
          :person="fromSimLook(s.look as any)"
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
