<script setup lang="ts">
// EnvLight - image based lighting for the whole scene. A procedural studio
// environment (no downloads) is prefiltered once with PMREM and set as
// scene.environment, so PBR materials (glass towers, cars, clothing) pick
// up soft sky light and reflections instead of looking flat. Its strength
// follows the day/night factor.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const ctx = useTresContext() as any
const night = useState<number>('kk_night', () => 0)
let envTex: THREE.Texture | null = null

function init(): boolean {
  const renderer: THREE.WebGLRenderer | undefined = ctx.renderer?.instance ?? ctx.renderer?.value
  const scene: THREE.Scene | undefined = ctx.scene?.value ?? ctx.scene
  if (!renderer || !scene || typeof (renderer as any).compile !== 'function') return false
  const pmrem = new THREE.PMREMGenerator(renderer)
  envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = envTex
  return true
}

let failed = false
const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  if (!envTex && !failed) {
    try {
      init()
    } catch {
      failed = true // IBL is a nice-to-have; never break the frame
    }
  }
  const scene: THREE.Scene | undefined = ctx.scene?.value ?? ctx.scene
  if (scene && envTex) scene.environmentIntensity = 0.55 - night.value * 0.45
})

onBeforeUnmount(() => envTex?.dispose())
</script>

<template>
  <TresGroup />
</template>
