<script setup lang="ts">
// CameraRig - third-person follow camera with user orbit.
// Must live INSIDE <TresCanvas> so useLoop binds to the canvas render loop.
// Right-drag / two-finger drag orbits (yaw + pitch), wheel zooms
// (see PointerControls). Keyboard/click movement always stays available.

import * as THREE from 'three'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [0, 0, 42])
const orbit = useCamOrbit()

const camera = ref()
const followTarget = new THREE.Vector3()
const desired = new THREE.Vector3()

// smoothed orbit values so the view glides instead of jumping
const smooth = { yaw: 0, pitch: 0.58, dist: 20 }

const { onBeforeRender } = useLoop()

onBeforeRender(({ delta }) => {
  const cam = camera.value
  if (!cam) return
  const k = 1 - Math.pow(0.0015, Math.min(delta || 0.016, 0.1)) // frame-rate safe damping
  smooth.yaw += (orbit.value.yaw - smooth.yaw) * k
  smooth.pitch += (orbit.value.pitch - smooth.pitch) * k
  smooth.dist += (orbit.value.dist - smooth.dist) * k

  const px = playerPos.value[0]
  const pz = playerPos.value[2]
  const horiz = Math.cos(smooth.pitch) * smooth.dist
  desired.set(
    px + Math.sin(smooth.yaw) * horiz,
    1.4 + Math.sin(smooth.pitch) * smooth.dist,
    pz + Math.cos(smooth.yaw) * horiz
  )
  cam.position.lerp(desired, k)
  followTarget.set(px, 1.6, pz)
  cam.lookAt(followTarget)
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
