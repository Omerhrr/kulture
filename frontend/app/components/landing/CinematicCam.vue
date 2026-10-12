<script setup lang="ts">
// CinematicCam - slow fly-around camera for the landing hero.
// Must live INSIDE <TresCanvas> so useLoop binds to the canvas render loop.

const camera = ref()

const { onBeforeRender } = useLoop()

onBeforeRender(({ elapsed }) => {
  const cam = camera.value
  if (!cam) return
  const t = (elapsed || 0) * 0.045
  // slow drift over the city center, gentle vertical bob
  // slow orbit over the CBD skyline (world is WORLD_SCALE x the bake)
  const radius = 430 + Math.sin(t * 0.7) * 70
  cam.position.set(Math.sin(t) * radius - 180, 150 + Math.sin(t * 1.3) * 25, Math.cos(t) * radius + 240)
  cam.lookAt(-140, 20, 200)
})
</script>

<template>
  <TresPerspectiveCamera ref="camera" :position="[130, 90, 280]" :fov="52" :near="0.5" :far="9000" />
</template>
