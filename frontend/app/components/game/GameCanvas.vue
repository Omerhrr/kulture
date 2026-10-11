<script setup lang="ts">
// GameCanvas — TresJS canvas + lighting + world + avatars.
// NOTE: anything using useRenderLoop must be a CHILD of TresCanvas
// (see CameraRig / PlayerAvatar / NpcAvatar).

const world = useWorldStore()

const musa = computed(() => world.npcEntities.find((e) => e.code === 'npc_musa'))
const amina = computed(() => world.npcEntities.find((e) => e.code === 'npc_amina'))
</script>

<template>
  <TresCanvas shadows :clear-color="'#87b7d4'">
    <CameraRig />
    <TresFog :args="['#87b7d4', 60, 220]" />

    <TresAmbientLight :intensity="0.75" color="#fff4e0" />
    <TresDirectionalLight
      :position="[40, 60, 30]"
      :intensity="1.5"
      color="#fff2d8"
      cast-shadow
      :shadow-mapSize-width="2048"
      :shadow-mapSize-height="2048"
      :shadow-camera-left="-80"
      :shadow-camera-right="80"
      :shadow-camera-top="80"
      :shadow-camera-bottom="-80"
    />
    <TresHemisphereLight :args="['#bfd9e8', '#8a7d5a', 0.55]" />

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
