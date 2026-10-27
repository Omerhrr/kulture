<script setup lang="ts">
// CharacterAvatar v5 - a realistic person (utils/humanBody: MakeHuman-based
// body, CC0) dressed by utils/outfits and animated procedurally
// (utils/rigDriver: walk / run / sit / activities + actions). Used for the
// player, NPCs, the crowd, other players and vehicle passengers.
//
// Pass `person` (a PersonLook: gender, skin, face + build, outfit). The older
// props (shirt / trouser / hairStyle / outfit...) still work and are mapped
// to modern everyday clothes; kufi / hijab / kaftan are no longer drawn.
//   action / actionKey - play jump | punch | kick | push | wave | stagger
//   seat               - surface height for sit / eat / sleep (metres)
import * as THREE from 'three'
import { buildBody, bodyIfLoaded, loadBody, preloadHumans } from '~/utils/humanBody'
import { legacyLook, type PersonLook } from '~/utils/people'
import type { Activity } from '~/utils/poses'
import { ACTION_DUR, type ActionName, type BaseMode } from '~/utils/humanAnim'
import { RigDriver } from '~/utils/rigDriver'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    person?: PersonLook
    // legacy look props
    shirt?: string
    trouser?: string
    skin?: string
    hairStyle?: string
    hairColor?: string
    beard?: boolean
    outfit?: string
    female?: boolean
    // retired (accepted so old call sites don't leak them onto the 3D node)
    real?: boolean
    kufi?: boolean
    hijab?: boolean
    gadgets?: unknown[]
    print?: number
    scarf?: string
    dress?: string
    // motion
    scale?: number
    mode?: BaseMode | Activity
    gaitSpeed?: number
    phase?: number
    action?: ActionName | null
    actionKey?: number
    seat?: number
  }>(),
  {
    person: undefined,
    shirt: undefined,
    trouser: undefined,
    skin: undefined,
    hairStyle: undefined,
    hairColor: undefined,
    beard: undefined,
    outfit: undefined,
    female: undefined,
    real: true,
    kufi: false,
    hijab: false,
    gadgets: () => [],
    print: undefined,
    scarf: undefined,
    dress: undefined,
    scale: 1,
    mode: 'idle',
    gaitSpeed: 11,
    phase: 0,
    action: null,
    actionKey: 0,
    seat: 0.45
  }
)

const look: PersonLook =
  props.person ??
  legacyLook({
    female: props.female,
    skin: props.skin,
    shirt: props.shirt,
    trouser: props.trouser,
    hairStyle: props.hairStyle,
    hairColor: props.hairColor,
    outfit: props.outfit,
    beard: props.beard,
    // a stable seed per look, so the same person always dresses the same
    seed: [...`${props.skin}${props.shirt}${props.trouser}${props.phase}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100000
  })

const holder = new THREE.Group()
holder.scale.setScalar(props.scale)
let person: ReturnType<typeof buildBody> | null = null
let driver: RigDriver | null = null
let disposed = false
function build() {
  const base = bodyIfLoaded(look.female ? 'female' : 'male')
  if (!base || disposed) return
  person = buildBody(base, { gender: base.gender, skin: look.skin, morphs: look.shape }, look.outfit)
  driver = new RigDriver(person, props.phase)
  holder.add(person.root)
}
if (bodyIfLoaded(look.female ? 'female' : 'male')) build()
else void Promise.all([loadBody(look.female ? 'female' : 'male'), preloadHumans()]).then(build)

let action: ActionName | null = null
let actionT = 0
watch(
  () => props.actionKey,
  () => {
    if (props.action) {
      action = props.action
      actionT = 0
    }
  }
)

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  if (!driver) return
  const dt = Math.min(delta || 0.016, 0.1)
  if (action) {
    actionT += dt
    if (actionT > ACTION_DUR[action]) action = null
  }
  driver.update(dt, { mode: props.mode, gaitSpeed: props.gaitSpeed, seat: props.seat, action, actionT })
})

onBeforeUnmount(() => {
  disposed = true
  person?.dispose()
})
</script>

<template>
  <primitive :object="holder" />
</template>
