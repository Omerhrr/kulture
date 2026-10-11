<script setup lang="ts">
// HeroWorld - the landing page hero: the actual 3D Kaduna neighborhood
// rendered live behind the page, with a slow cinematic fly-around camera.
// No player, no HUD, no pointer capture: this is a postcard of the world
// you are about to enter.
//
// NOTE: anything using useLoop must be a CHILD of TresCanvas
// (that is why the camera lives in CinematicCam.vue).

// NPCs stand where the seed puts them (server entities are not needed here;
// WorldScene falls back to the same coordinates when the store is empty).
const musaPos: [number, number] = [-16.5, -8.5]
const aminaPos: [number, number] = [33, 20.5]
</script>

<template>
  <TresCanvas shadows :clear-color="'#87b7d4'">
    <CinematicCam />
    <TresFog :args="['#87b7d4', 70, 260]" />

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
    <NpcAvatar :x="musaPos[0]" :z="musaPos[1]" name="Mallam Musa" shirt="#b8433a" />
    <NpcAvatar :x="aminaPos[0]" :z="aminaPos[1]" name="Hajiya Amina" :female="true" shirt="#3f6fae" />
  </TresCanvas>
</template>
