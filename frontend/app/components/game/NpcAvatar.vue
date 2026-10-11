<script setup lang="ts">
// NpcAvatar - server-positioned NPC with idle animation and a distinct
// look (hair style, beard / hijab) so Musa and Amina read as characters,
// not clones.
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

const group = ref()

const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed }) => {
  const g = group.value
  if (!g) return
  g.position.y = Math.sin(elapsed * 1.6 + props.x) * 0.05
  g.rotation.y = Math.sin(elapsed * 0.35 + props.z) * 0.5
})
</script>

<template>
  <TresGroup ref="group" :position="[props.x, 0, props.z]">
    <CharacterAvatar
      :shirt="props.shirt"
      trouser="#3a3f4a"
      :kufi="!props.female"
      :hijab="props.female"
      :hair-style="props.female ? 'braids' : props.hairStyle"
      :beard="props.beard"
    />
    <TresMesh :position="[0, 0.02, 0]" :rotation="[-Math.PI / 2, 0, 0]">
      <TresCircleGeometry :args="[0.55, 20]" />
    </TresMesh>
  </TresGroup>
</template>
