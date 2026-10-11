<script setup lang="ts">
// HeroWorld - the landing page hero: the real Kaduna city map rendered
// live behind the page (river, districts, stadium, market, mosque), with a
// slow cinematic fly-around camera. No player, no HUD, no pointer
// capture: this is a postcard of the world you are about to enter.
//
// NOTE: anything using useLoop must be a CHILD of TresCanvas
// (that is why the camera lives in CinematicCam.vue).
</script>

<template>
  <TresCanvas shadows :clear-color="'#9ec7de'">
    <CinematicCam />
    <TresFog :args="['#9ec7de', 500, 2400]" />

    <TresAmbientLight :intensity="0.72" color="#fff4e0" />
    <TresDirectionalLight
      :position="[-260, 420, -170]"
      :intensity="1.5"
      color="#fff2d8"
      cast-shadow
      :shadow-mapSize-width="2048"
      :shadow-mapSize-height="2048"
      :shadow-camera-left="-700"
      :shadow-camera-right="700"
      :shadow-camera-top="700"
      :shadow-camera-bottom="-700"
      :shadow-camera-far="1600"
    />
    <TresHemisphereLight :args="['#bfd9e8', '#8a7d5a', 0.5]" />

    <KadunaCity />
  </TresCanvas>
</template>
