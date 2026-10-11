<script setup lang="ts">
// Shared low-poly character (player + NPCs). Nigerian street-wear palette.
import * as THREE from 'three'

const props = withDefaults(
  defineProps<{
    shirt?: string
    trouser?: string
    skin?: string
    kufi?: boolean
    hijab?: boolean
    scale?: number
  }>(),
  { shirt: '#2e7d5b', trouser: '#2b3440', skin: '#8a5a3b', kufi: true, hijab: false, scale: 1 }
)

const shirtMat = new THREE.MeshStandardMaterial({ color: props.shirt, roughness: 0.8 })
const trouserMat = new THREE.MeshStandardMaterial({ color: props.trouser, roughness: 0.9 })
const skinMat = new THREE.MeshStandardMaterial({ color: props.skin, roughness: 0.7 })
const hatMat = new THREE.MeshStandardMaterial({ color: '#e8e2d2', roughness: 0.9 })
const shoeMat = new THREE.MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.9 })
</script>

<template>
  <TresGroup :scale="[props.scale, props.scale, props.scale]">
    <!-- legs -->
    <TresMesh :position="[-0.16, 0.45, 0]" :material="trouserMat">
      <TresCylinderGeometry :args="[0.09, 0.11, 0.8, 8]" />
    </TresMesh>
    <TresMesh :position="[0.16, 0.45, 0]" :material="trouserMat">
      <TresCylinderGeometry :args="[0.09, 0.11, 0.8, 8]" />
    </TresMesh>
    <!-- shoes -->
    <TresMesh :position="[-0.16, 0.06, 0.05]" :material="shoeMat">
      <TresBoxGeometry :args="[0.18, 0.12, 0.32]" />
    </TresMesh>
    <TresMesh :position="[0.16, 0.06, 0.05]" :material="shoeMat">
      <TresBoxGeometry :args="[0.18, 0.12, 0.32]" />
    </TresMesh>
    <!-- torso -->
    <TresMesh :position="[0, 1.15, 0]" :material="shirtMat">
      <TresCylinderGeometry :args="[0.22, 0.26, 0.75, 10]" />
    </TresMesh>
    <!-- arms -->
    <TresMesh :position="[-0.34, 1.15, 0]" :rotation="[0, 0, 0.15]" :material="shirtMat">
      <TresCylinderGeometry :args="[0.07, 0.08, 0.62, 8]" />
    </TresMesh>
    <TresMesh :position="[0.34, 1.15, 0]" :rotation="[0, 0, -0.15]" :material="shirtMat">
      <TresCylinderGeometry :args="[0.07, 0.08, 0.62, 8]" />
    </TresMesh>
    <!-- hands -->
    <TresMesh :position="[-0.4, 0.85, 0]" :material="skinMat">
      <TresSphereGeometry :args="[0.08, 8, 8]" />
    </TresMesh>
    <TresMesh :position="[0.4, 0.85, 0]" :material="skinMat">
      <TresSphereGeometry :args="[0.08, 8, 8]" />
    </TresMesh>
    <!-- head -->
    <TresMesh :position="[0, 1.78, 0]" :material="skinMat">
      <TresSphereGeometry :args="[0.24, 14, 14]" />
    </TresMesh>
    <!-- kufi / hijab -->
    <TresMesh v-if="props.kufi && !props.hijab" :position="[0, 1.99, 0]" :material="hatMat">
      <TresCylinderGeometry :args="[0.25, 0.27, 0.13, 12]" />
    </TresMesh>
    <TresMesh v-if="props.hijab" :position="[0, 1.8, 0]" :material="hatMat">
      <TresSphereGeometry :args="[0.29, 14, 14]" />
    </TresMesh>
  </TresGroup>
</template>
