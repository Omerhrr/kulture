<script setup lang="ts">
// CharacterAvatar v3 - a skinned, fully jointed human (see utils/humanRig)
// animated procedurally (utils/humanAnim). Used for the player, named NPCs,
// other players and vehicle drivers.
//
// Props are backwards compatible with v2; new ones:
//   action / actionKey - play jump | punch | kick | push | wave | stagger
//                        (bump actionKey to replay the same action)
//   seat               - surface height for sit / eat / sleep (metres)
import { buildHuman } from '~/utils/humanRig'
import { HumanAnimator, ACTION_DUR, type ActionName, type BaseMode } from '~/utils/humanAnim'

const props = withDefaults(
  defineProps<{
    shirt?: string
    trouser?: string
    skin?: string
    kufi?: boolean
    hijab?: boolean
    hairStyle?: 'cap' | 'afro' | 'braids' | 'bald'
    hairColor?: string
    beard?: boolean
    outfit?: 'kaftan' | 'dress' | 'shirt'
    female?: boolean
    scale?: number
    mode?: BaseMode
    gaitSpeed?: number
    phase?: number
    action?: ActionName | null
    actionKey?: number
    seat?: number
  }>(),
  {
    shirt: '#2e7d5b',
    trouser: '#2b3440',
    skin: '#7a4e33',
    kufi: true,
    hijab: false,
    hairStyle: 'cap',
    hairColor: '#141114',
    beard: false,
    outfit: undefined,
    female: undefined,
    scale: 1,
    mode: 'idle',
    gaitSpeed: 11,
    phase: 0,
    action: null,
    actionKey: 0,
    seat: 0.45
  }
)

const outfit = props.outfit ?? (props.hijab ? 'dress' : props.kufi ? 'kaftan' : 'shirt')
const female = props.female ?? (outfit === 'dress' || props.hijab || props.hairStyle === 'braids')
const rig = buildHuman({
  outfit,
  top: props.shirt,
  bottom: props.trouser,
  skin: props.skin,
  hair: props.hairStyle,
  hairColor: props.hairColor,
  kufi: props.kufi && !props.hijab && props.hairStyle === 'cap',
  hijab: props.hijab,
  beard: props.beard,
  female
})
rig.root.scale.setScalar(props.scale)
const anim = new HumanAnimator(rig, props.phase)

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
  const dt = Math.min(delta || 0.016, 0.1)
  if (action) {
    actionT += dt
    if (actionT > ACTION_DUR[action]) action = null
  }
  anim.update(dt, {
    mode: props.mode,
    run: Math.min(1, Math.max(0, (props.gaitSpeed - 11.5) / 3.5)),
    gait: props.gaitSpeed * 0.62,
    seat: props.seat,
    action,
    actionT
  })
})

onBeforeUnmount(() => rig.dispose())
</script>

<template>
  <primitive :object="rig.root" />
</template>
