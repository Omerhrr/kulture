<script setup lang="ts">
// GameCanvas - TresJS canvas + lighting + the full Kaduna city + avatars.
// NOTE: anything using useLoop must be a CHILD of TresCanvas
// (see CameraRig / SunLight / PlayerAvatar / NpcAvatar).

const world = useWorldStore()

const musa = computed(() => world.npcEntities.find((e) => e.code === 'npc_musa'))
const amina = computed(() => world.npcEntities.find((e) => e.code === 'npc_amina'))

// mount telemetry (headless debugging)
onMounted(() => {
  const w = window as any
  w.__kk_canvas_mounts = (w.__kk_canvas_mounts || 0) + 1
})
onUnmounted(() => {
  const w = window as any
  w.__kk_canvas_unmounts = (w.__kk_canvas_unmounts || 0) + 1
})
</script>

<template>
  <TresCanvas shadows :clear-color="'#9ec7de'">
    <CameraRig />
    <PointerControls />
    <TresFog :args="['#9ec7de', 420, 2500]" />

    <TresAmbientLight :intensity="0.72" color="#fff4e0" />
    <SunLight />
    <TresHemisphereLight :args="['#bfd9e8', '#8a7d5a', 0.5]" />

    <KadunaCity />
    <WorldScene />
    <PlayerAvatar />
    <NpcAvatar
      v-if="musa"
      :x="musa.position[0]"
      :z="musa.position[2]"
      name="Mallam Musa"
      shirt="#b8433a"
    />
    <NpcAvatar
      v-if="amina"
      :x="amina.position[0]"
      :z="amina.position[2]"
      name="Hajiya Amina"
      :female="true"
      shirt="#3f6fae"
    />
  </TresCanvas>
</template>
