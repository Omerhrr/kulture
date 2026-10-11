<script setup lang="ts">
// SunLight - directional light that follows the player so the shadow
// camera (small, sharp) always covers the player's neighborhood anywhere
// in the 20+ km city map. Time aware: it is the sun by day (warm at
// dawn/dusk) and a dim blue moon by night, driven by the DayNight clock.

import * as THREE from 'three'
import { useClock, sunState, skyPalette } from '~/composables/useTimeOfDay'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const hour = useClock()

const light = ref()
const targetObj = new THREE.Object3D()
const sunColor = new THREE.Color('#fff2d8')
const moonColor = new THREE.Color('#8fa8d8')
const duskColor = new THREE.Color('#ff9a4d')

const { onBeforeRender } = useLoop()

onBeforeRender(({ delta }) => {
  const l = light.value
  if (!l) return
  const s = sunState(hour.value)
  const pal = skyPalette(s)
  const px = playerPos.value[0]
  const pz = playerPos.value[2]
  targetObj.position.set(px, 0, pz)
  // day: the sun rides its arc; night: a high dim moon keeps soft shadows
  if (s.sy > 0.02) {
    l.position.set(px + s.sx * 130, 30 + s.sy * 90, pz + s.sz * 130)
    sunColor.set(pal.sun)
    l.color.copy(sunColor)
    l.intensity = 0.25 + s.daylight * 1.45
  } else {
    // moon opposite the sun, fixed elevation
    l.position.set(px - s.sx * 130 + 40, 95, pz - s.sz * 130 - 25)
    l.color.copy(moonColor)
    l.intensity = 0.5 + s.night * 0.1
  }
  void duskColor
  void delta
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
