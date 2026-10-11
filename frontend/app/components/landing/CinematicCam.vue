<script setup lang="ts">
// CinematicCam - slow fly-around camera for the landing hero.
// Must live INSIDE <TresCanvas> so useLoop binds to the canvas render loop.

const camera = ref()

const { onBeforeRender } = useLoop()

onBeforeRender(({ elapsed }) => {
  const cam = camera.value
  if (!cam) return
  const t = (elapsed || 0) * 0.06
  // slow drift around the neighborhood, gentle vertical bob
  const radius = 62 + Math.sin(t * 0.7) * 4
  cam.position.set(Math.sin(t) * radius, 26 + Math.sin(t * 1.3) * 3, Math.cos(t) * radius + 10)
  cam.lookAt(0, 2, 0)
})
</script>

<template>
  <TresPerspectiveCamera ref="camera" :position="[50, 26, 50]" :fov="50" :near="0.5" :far="500" />
</template>
