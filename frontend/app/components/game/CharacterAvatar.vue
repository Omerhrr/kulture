<script setup lang="ts">
// CharacterAvatar v4 - the stylized, fully jointed person (utils/humanRig)
// animated procedurally (utils/humanAnim). One look for everyone: the
// player, named NPCs, the crowd, other players and vehicle drivers.
//
// Activities (pray, dance, cook, type...) are the poses of utils/poses,
// layered over the procedural base through a bone-name bridge; gadgets
// (phone, sunglasses, cap, backpack...) hang off the rig's bones.
//
// Props are backwards compatible; notable ones:
//   action / actionKey - play jump | punch | kick | push | wave | stagger
//                        (bump actionKey to replay the same action)
//   seat               - surface height for sit / eat / sleep (metres)
//   real               - accepted for compatibility; the realistic mocap
//                        bodies are retired (one cohesive stylized cast)
import { buildHuman } from '~/utils/humanRig'
import { RIG_GADGET_MOUNTS, wearGadgets, type Gadget } from '~/utils/wardrobe'
import type { Activity } from '~/utils/poses'
import { ACTION_DUR, type ActionName, type BaseMode } from '~/utils/humanAnim'
import { RigDriver } from '~/utils/rigDriver'

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
    mode?: BaseMode | Activity
    gaitSpeed?: number
    phase?: number
    action?: ActionName | null
    actionKey?: number
    seat?: number
    real?: boolean
    /** extra props worn on the body */
    gadgets?: Gadget[]
    /** ankara print strength 0..1 (not drawn on the stylized rig yet) */
    print?: number
    /** force a body: 'modern' (shirt/trousers) or 'traditional' (kaftan / gown + hijab) */
    dress?: 'modern' | 'traditional'
    /** hijab colour */
    scarf?: string
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
    seat: 0.45,
    real: false,
    gadgets: () => [],
    print: undefined,
    dress: undefined,
    scarf: undefined
  }
)

const traditionalDress = props.dress === 'traditional'
const wantsHijab = props.hijab || props.gadgets.includes('hijab')
const female = props.female ?? (props.outfit === 'dress' || wantsHijab || props.hairStyle === 'braids')
const outfit =
  props.dress === 'modern' ? 'shirt' : props.outfit ?? (traditionalDress ? (female ? 'dress' : 'kaftan') : wantsHijab ? 'dress' : props.kufi ? 'kaftan' : 'shirt')
const hijab = wantsHijab || (traditionalDress && female)
const rig = buildHuman({
  outfit,
  top: props.shirt,
  bottom: outfit === 'kaftan' && traditionalDress ? props.shirt : props.trouser,
  skin: props.skin,
  hair: props.hairStyle,
  hairColor: props.hairColor,
  kufi: !hijab && ((props.kufi && props.hairStyle === 'cap') || props.gadgets.includes('kufi')),
  hijab,
  beard: props.beard,
  female,
  scarf: props.scarf
})
rig.root.scale.setScalar(props.scale)
// gadgets the rig does not model itself (kufi + hijab are part of the rig)
wearGadgets(rig.root, rig.bones, { skin: props.skin, top: props.shirt, bottom: props.trouser, gadgets: props.gadgets.filter((g) => g !== 'kufi' && g !== 'hijab') }, RIG_GADGET_MOUNTS)
const driver = new RigDriver(rig, props.phase)

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
  driver.update(dt, { mode: props.mode, gaitSpeed: props.gaitSpeed, seat: props.seat, action, actionT })
})

onBeforeUnmount(() => rig.dispose())
</script>

<template>
  <primitive :object="rig.root" />
</template>
