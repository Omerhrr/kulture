<script setup lang="ts">
// NpcAvatar - a named server NPC as a living character, not a statue.
// Idle at their post with glances; punched or run over they go DOWN
// (fall, lie, get up), then act on their own accord: some fight back
// (chase you and swing - your avatar staggers), some take off. Afterward
// they walk back to their post. Registered with the impact registry so
// punches (hitNamed) and cars (TrafficSystem / CrowdSystem) reach them,
// and published into the traffic probe so drivers brake for them.
import { registerNamed, namedDebug } from '~/utils/impact'
import { trafficProbe } from '~/utils/trafficProbe'
import { collidesRadius } from '~/utils/collision'
import { kkAudio } from '~/utils/audio'
import { useInterior } from '~/composables/useControlsState'
import type { ActionName } from '~/utils/humanAnim'

const props = withDefaults(
  defineProps<{
    x: number
    z: number
    name: string
    female?: boolean
    shirt?: string
    hairStyle?: 'cap' | 'afro' | 'braids' | 'bald'
    beard?: boolean
  }>(),
  { female: false, shirt: '#b8433a', hairStyle: 'cap', beard: false }
)

type Mood = 'idle' | 'down' | 'fight' | 'flee' | 'return'
// temperament per character (deterministic): most stand their ground
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}
const fighter = hashStr(props.name) < 0.55

const group = ref()
const interiorRef = useInterior()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])

// state
const mood = ref<Mood>('idle')
const mode = ref<'idle' | 'walk'>('idle')
const gaitSpeed = ref(7)
const action = ref<ActionName | null>(null)
const actionKey = ref(0)
const pos = { x: props.x, z: props.z } // live position (per-frame, no reactivity)
const home = { x: props.x, z: props.z }
let heading = 0
let lie = 0 // 0 standing .. 1 lying flat
let downT = 0
let anger = 0
let fleeT = 0
let swingCd = 0
let kvx = 0
let kvz = 0

function slide(dx: number, dz: number) {
  const r = 0.45
  if (!collidesRadius(pos.x + dx, pos.z + dz, r, pos.x, pos.z)) {
    pos.x += dx
    pos.z += dz
    return true
  }
  if (dx !== 0 && !collidesRadius(pos.x + dx, pos.z, r, pos.x, pos.z)) {
    pos.x += dx
    return true
  }
  if (dz !== 0 && !collidesRadius(pos.x, pos.z + dz, r, pos.x, pos.z)) {
    pos.z += dz
    return true
  }
  return false
}

function face(dx: number, dz: number) {
  heading = Math.atan2(dx, dz)
}

function punchPlayer(dx: number, dz: number, d: number) {
  action.value = 'punch'
  actionKey.value++
  window.dispatchEvent(
    new CustomEvent('kk-player-hit', {
      detail: { dir: [dx / d, dz / d], action: 'punch', from: props.name }
    })
  )
  kkAudio.impact(0.5)
}

// impact registry: punches and cars land here
const unregister = registerNamed({
  code: props.name,
  x: () => pos.x,
  z: () => pos.z,
  hit(dirX, dirZ, power) {
    if (mood.value === 'down') return false
    mood.value = 'down'
    downT = 0
    kvx = dirX * power
    kvz = dirZ * power
    face(-dirX, -dirZ)
    action.value = 'stagger'
    actionKey.value++
    kkAudio.impact(Math.min(1, power / 8))
    return true
  }
})
onBeforeUnmount(unregister)

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  const dt = Math.min(delta || 0.016, 0.1)
  const g = group.value
  if (!g) return

  switch (mood.value) {
    case 'down': {
      downT += dt
      const fr = Math.exp(-4 * dt)
      kvx *= fr
      kvz *= fr
      slide(kvx * dt, kvz * dt)
      lie = downT < 2.5 ? Math.min(1, downT / 0.3) : Math.max(0, 1 - (downT - 2.5) / 0.6)
      mode.value = 'idle'
      if (downT > 3.2) {
        lie = 0
        if (fighter) {
          mood.value = 'fight'
          anger = 10
        } else {
          mood.value = 'flee'
          fleeT = 4
        }
      }
      break
    }
    case 'fight': {
      anger -= dt
      const dx = playerPos.value[0] - pos.x
      const dz = playerPos.value[2] - pos.z
      const d = Math.hypot(dx, dz) || 1
      if (interiorRef.value.inside || anger <= 0 || d > 24) {
        mood.value = 'return'
        mode.value = 'walk'
        gaitSpeed.value = 6.5
        break
      }
      face(dx, dz)
      if (d > 1.35) {
        mode.value = 'walk'
        gaitSpeed.value = 9.5
        slide((dx / d) * 3.4 * dt, (dz / d) * 3.4 * dt)
      } else {
        mode.value = 'idle'
        swingCd -= dt
        if (swingCd <= 0) {
          swingCd = 1.4
          punchPlayer(dx, dz, d)
        }
      }
      break
    }
    case 'flee': {
      fleeT -= dt
      const dx = pos.x - playerPos.value[0]
      const dz = pos.z - playerPos.value[2]
      const d = Math.hypot(dx, dz) || 1
      if (fleeT <= 0 || d > 40) {
        mood.value = 'return'
        mode.value = 'walk'
        gaitSpeed.value = 6.5
        break
      }
      face(dx, dz)
      mode.value = 'walk'
      gaitSpeed.value = 10.5
      slide((dx / d) * 4.2 * dt, (dz / d) * 4.2 * dt)
      break
    }
    case 'return': {
      const dx = home.x - pos.x
      const dz = home.z - pos.z
      const d = Math.hypot(dx, dz)
      if (d < 0.25) {
        mood.value = 'idle'
        mode.value = 'idle'
        break
      }
      face(dx, dz)
      mode.value = 'walk'
      gaitSpeed.value = 6.5
      const step = Math.min(d, 2.4 * dt)
      if (!slide((dx / d) * step, (dz / d) * step)) mood.value = 'idle'
      break
    }
    default: {
      // idle at the post: glance around, swaying around the last heading
      mode.value = 'idle'
      g.rotation.y = heading + Math.sin(elapsed * 0.25 + props.z) * 0.6
    }
  }

  // publish to traffic so drivers brake for them (CrowdSystem rebuilds the
  // array first each frame; appending here survives until its next sweep)
  if (mood.value !== 'down' && trafficProbe.peds.length < 220) {
    trafficProbe.peds.push({ x: pos.x, z: pos.z })
  }

  // apply transform
  if (mood.value !== 'idle') g.rotation.y = heading
  g.rotation.order = 'YXZ'
  g.rotation.x = -lie * Math.PI * 0.47
  g.position.set(pos.x, lie * 0.16, pos.z)
})

// headless test hook: live state of every named character
const snap = () => ({
  code: props.name,
  state: mood.value,
  x: +pos.x.toFixed(1),
  z: +pos.z.toFixed(1),
  fighter,
  downT: +downT.toFixed(2),
  anger: +anger.toFixed(1),
  lie: +lie.toFixed(2)
})
namedDebug.push(snap)
onBeforeUnmount(() => {
  unregister()
  const i = namedDebug.indexOf(snap)
  if (i >= 0) namedDebug.splice(i, 1)
  const w = window as any
  if (w.__kk_named) delete w.__kk_named
})
if (import.meta.dev) {
  ;(window as any).__kk_named = (code?: string) => {
    const all = namedDebug.map((f) => f())
    return code ? all.find((n: any) => n.code === code) : all
  }
}
</script>

<template>
  <TresGroup ref="group" :position="[props.x, 0, props.z]">
    <CharacterAvatar real
      :shirt="props.shirt"
      trouser="#3a3f4a"
      :kufi="!props.female"
      :hijab="props.female"
      :hair-style="props.female ? 'braids' : props.hairStyle"
      :beard="props.beard"
      :mode="mode"
      :gait-speed="gaitSpeed"
      :action="action"
      :action-key="actionKey"
    />
    <TresMesh :position="[0, 0.02, 0]" :rotation="[-Math.PI / 2, 0, 0]">
      <TresCircleGeometry :args="[0.42, 20]" />
      <TresMeshBasicMaterial color="#000000" transparent :opacity="0.22" :depth-write="false" />
    </TresMesh>
  </TresGroup>
</template>
