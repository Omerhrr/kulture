<script setup lang="ts">
// CameraRig — third-person follow camera. Must live INSIDE <TresCanvas>
// so useRenderLoop binds to the canvas render loop.

import * as THREE from 'three'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [0, 0, 42])

const camera = ref()
const followTarget = new THREE.Vector3()

const { onBeforeRender } = useLoop()

onBeforeRender(() => {
  const cam = camera.value
  if (!cam) return
  followTarget.set(playerPos.value[0], 11, playerPos.value[2] + 17)
  cam.position.lerp(followTarget, 0.08)
  cam.lookAt(playerPos.value[0], 1.4, playerPos.value[2])
})
</script>

<template>
  <TresPerspectiveCamera
    ref="camera"
    :position="[0, 11, 59]"
    :fov="55"
    :near="0.5"
    :far="400"
  />
</template>
