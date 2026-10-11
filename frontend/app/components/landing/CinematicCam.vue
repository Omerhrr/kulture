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
  const radius = 190 + Math.sin(t * 0.7) * 30
  cam.position.set(Math.sin(t) * radius - 60, 90 + Math.sin(t * 1.3) * 12, Math.cos(t) * radius + 90)
  cam.lookAt(-40, 0, 90)
})
</script>

<template>
  <TresPerspectiveCamera ref="camera" :position="[130, 90, 280]" :fov="52" :near="0.5" :far="4200" />
</template>
