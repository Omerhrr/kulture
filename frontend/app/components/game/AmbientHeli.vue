<script setup lang="ts">
// AmbientHeli - a police / news helicopter (your helicopter.glb design)
// circling over the town centre: main + tail rotors spin, it banks into the
// turn and you hear it when it passes overhead.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BAKE } from '~/utils/kaduna'

const root = new THREE.Group()
let main: THREE.Object3D | null = null
let tail: THREE.Object3D | null = null
const centre = BAKE.landmarks.find((l) => l.kind === 'square') ?? BAKE.landmarks.find((l) => l.kind === 'market') ?? { x: 0, z: 0 }

onMounted(async () => {
  try {
    const g = await new GLTFLoader().loadAsync('/models/vehicles/helicopter.glb')
    const heli = g.scene
    // the model is ~5 m long; a real light helicopter is ~11 m
    heli.scale.setScalar(2.1)
    // model's nose points +X: turn it to face +Z (the travel direction)
    heli.rotation.y = -Math.PI / 2
    heli.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        const mat = m.material as THREE.MeshStandardMaterial
        if (mat?.isMeshStandardMaterial) {
          // a little gloss so it reads as painted metal, not plastic
          mat.roughness = Math.min(mat.roughness, 0.45)
          mat.metalness = Math.max(mat.metalness, 0.15)
        }
      }
    })
    main = heli.getObjectByName('MainRotor') ?? null
    tail = heli.getObjectByName('TailRotor') ?? null
    root.add(heli)
  } catch {
    /* model missing: no helicopter */
  }
})

const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  const t = performance.now() / 1000
  if (main) main.rotation.y += 0.9
  if (tail) tail.rotation.z += 1.1
  // slow orbit (≈ 600 m wide, 75 m up) with a gentle bob
  const a = t * 0.045
  const R = 300
  root.position.set(centre.x + Math.cos(a) * R, 75 + Math.sin(t * 0.7) * 2, centre.z + Math.sin(a) * R)
  root.rotation.set(0, -a, 0)
  root.rotation.z = 0
  root.rotateZ(0.12) // banked into the turn
})
</script>

<template>
  <primitive :object="root" />
</template>
