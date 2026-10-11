<script setup lang="ts">
// SunLight - directional light that follows the player so the shadow
// camera (small, sharp) always covers the player's neighborhood anywhere
// in the 20+ km city map.

import * as THREE from 'three'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])

const light = ref()
const targetObj = new THREE.Object3D()

const { onBeforeRender } = useLoop()

onBeforeRender(() => {
  const l = light.value
  if (!l) return
  const px = playerPos.value[0]
  const pz = playerPos.value[2]
  targetObj.position.set(px, 0, pz)
  l.position.set(px + 70, 110, pz + 45)
  l.target = targetObj
})
</script>

<template>
  <TresGroup>
    <primitive :object="targetObj" />
    <TresDirectionalLight
      ref="light"
      :position="[0, 110, 45]"
      :intensity="1.6"
      color="#fff2d8"
      cast-shadow
      :shadow-mapSize-width="2048"
      :shadow-mapSize-height="2048"
      :shadow-camera-left="-70"
      :shadow-camera-right="70"
      :shadow-camera-top="70"
      :shadow-camera-bottom="-70"
      :shadow-camera-far="320"
      :shadow-bias="-0.0004"
    />
  </TresGroup>
</template>
