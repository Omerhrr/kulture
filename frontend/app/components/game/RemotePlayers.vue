<script setup lang="ts">
// RemotePlayers - everyone else who is online near you. The server streams a
// 1 Hz snapshot of nearby players (positions it already accepted); we glide
// each avatar toward its latest position and float an @name tag above it.
import * as THREE from 'three'

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
    const byId = new Map(shown.value.map((s) => [s.id, s]))
    const next: Shown[] = []
    for (const p of list) {
      const cur = byId.get(p.id)
      const lookKey = JSON.stringify(p.look)
      if (cur) {
        cur.tx = p.pos[0]
        cur.tz = p.pos[2]
        cur.th = p.facing
        cur.moving = p.moving
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
        next.push({ id: p.id, name: p.name, x: p.pos[0], z: p.pos[2], h: p.facing, tx: p.pos[0], tz: p.pos[2], th: p.facing, moving: p.moving, look: p.look, lookKey, tag: t.tex, tagW: t.w, action: null, actionKey: 0 })
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
})
if (import.meta.dev && typeof window !== 'undefined') (window as any).__kk_remotes = () => shown.value.map((s) => ({ name: s.name, x: +s.x.toFixed(1), z: +s.z.toFixed(1) }))
</script>

<template>
  <TresGroup>
    <TresGroup v-for="s in shown" :key="s.id" :position="[s.x, 0, s.z]">
      <TresGroup :rotation="[0, s.h, 0]">
        <CharacterAvatar
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
          :mode="s.moving ? 'walk' : 'idle'"
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
