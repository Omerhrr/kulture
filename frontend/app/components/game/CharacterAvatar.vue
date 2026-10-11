<script setup lang="ts">
// Shared low-poly character (player + NPCs) with an articulated rig:
// legs and arms swing around hip/shoulder pivots so walking reads as a
// human gait instead of a stiff bob. Animation modes:
//   walk - full gait cycle (legs alternate, arms counter-swing)
//   idle - subtle breathing sway
//   sit  - seated pose for vehicle interiors
// The rig is driven internally from useLoop; parents just set `mode`.
import * as THREE from 'three'

const props = withDefaults(
  defineProps<{
    shirt?: string
    trouser?: string
    skin?: string
    kufi?: boolean
    hijab?: boolean
    scale?: number
    mode?: 'idle' | 'walk' | 'sit'
    gaitSpeed?: number // walk cycle rad/s baseline
    phase?: number // de-sync multiple characters
  }>(),
  {
    shirt: '#2e7d5b',
    trouser: '#2b3440',
    skin: '#8a5a3b',
    kufi: true,
    hijab: false,
    scale: 1,
    mode: 'idle',
    gaitSpeed: 9.5,
    phase: 0
  }
)

const shirtMat = new THREE.MeshStandardMaterial({ color: props.shirt, roughness: 0.8 })
const trouserMat = new THREE.MeshStandardMaterial({ color: props.trouser, roughness: 0.9 })
const skinMat = new THREE.MeshStandardMaterial({ color: props.skin, roughness: 0.7 })
const hatMat = new THREE.MeshStandardMaterial({ color: props.hijab ? '#e8e2d2' : props.shirt === '#2e7d5b' ? '#e8e2d2' : '#f2ede0', roughness: 0.9 })
const shoeMat = new THREE.MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.9 })
const hairMat = new THREE.MeshStandardMaterial({ color: '#17141a', roughness: 0.95 })

// pivot groups (updated every frame)
const legL = ref()
const legR = ref()
const armL = ref()
const armR = ref()
const body = ref()

let t = props.phase
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  const dt = Math.min(delta || 0.016, 0.1)
  const l = legL.value
  const r = legR.value
  const al = armL.value
  const ar = armR.value
  const b = body.value
  if (!l || !r) return

  if (props.mode === 'walk') {
    t += dt * props.gaitSpeed
    const s = Math.sin(t)
    const c = Math.cos(t)
    // legs swing around the hip, slight knee via second harmonic
    l.rotation.x = s * 0.62
    r.rotation.x = -s * 0.62
    l.rotation.z = 0
    r.rotation.z = 0
    // arms counter-swing with a touch of outward drift
    if (al && ar) {
      al.rotation.x = -s * 0.45
      ar.rotation.x = s * 0.45
      al.rotation.z = 0.12 + Math.max(0, c) * 0.06
      ar.rotation.z = -0.12 - Math.max(0, -c) * 0.06
    }
    if (b) {
      b.position.y = Math.abs(Math.cos(t)) * 0.05
      b.rotation.z = s * 0.03
    }
  } else if (props.mode === 'sit') {
    l.rotation.x = -1.35
    r.rotation.x = -1.35
    if (al && ar) {
      al.rotation.x = -0.55
      ar.rotation.x = -0.55
      al.rotation.z = 0.25
      ar.rotation.z = -0.25
    }
    if (b) b.position.y = 0
  } else {
    // idle: breathing + weight shift
    const e = elapsed + props.phase * 3.1
    l.rotation.x = 0
    r.rotation.x = 0
    if (al && ar) {
      al.rotation.x = Math.sin(e * 1.4) * 0.05
      ar.rotation.x = -Math.sin(e * 1.4) * 0.05
      al.rotation.z = 0.15 + Math.sin(e * 0.9) * 0.03
      ar.rotation.z = -0.15 - Math.sin(e * 0.9) * 0.03
    }
    if (b) {
      b.position.y = Math.sin(e * 2.1) * 0.015
      b.rotation.z = Math.sin(e * 0.7) * 0.015
    }
  }
})
</script>

<template>
  <TresGroup :scale="[props.scale, props.scale, props.scale]">
    <TresGroup ref="body">
      <!-- legs: pivot at the hip, mesh hangs below -->
      <TresGroup ref="legL" :position="[-0.16, 0.85, 0]">
        <TresMesh :position="[0, -0.4, 0]" :material="trouserMat">
          <TresCylinderGeometry :args="[0.09, 0.11, 0.8, 8]" />
        </TresMesh>
        <TresMesh :position="[0, -0.79, 0.05]" :material="shoeMat">
          <TresBoxGeometry :args="[0.18, 0.12, 0.32]" />
        </TresMesh>
      </TresGroup>
      <TresGroup ref="legR" :position="[0.16, 0.85, 0]">
        <TresMesh :position="[0, -0.4, 0]" :material="trouserMat">
          <TresCylinderGeometry :args="[0.09, 0.11, 0.8, 8]" />
        </TresMesh>
        <TresMesh :position="[0, -0.79, 0.05]" :material="shoeMat">
          <TresBoxGeometry :args="[0.18, 0.12, 0.32]" />
        </TresMesh>
      </TresGroup>

      <!-- torso -->
      <TresMesh :position="[0, 1.15, 0]" :material="shirtMat">
        <TresCylinderGeometry :args="[0.22, 0.26, 0.75, 10]" />
      </TresMesh>
      <!-- hips -->
      <TresMesh :position="[0, 0.82, 0]" :material="trouserMat">
        <TresCylinderGeometry :args="[0.24, 0.24, 0.18, 10]" />
      </TresMesh>

      <!-- arms: pivot at the shoulder -->
      <TresGroup ref="armL" :position="[-0.34, 1.44, 0]">
        <TresMesh :position="[0, -0.28, 0]" :material="shirtMat">
          <TresCylinderGeometry :args="[0.07, 0.08, 0.52, 8]" />
        </TresMesh>
        <TresMesh :position="[0, -0.6, 0]" :material="skinMat">
          <TresSphereGeometry :args="[0.08, 8, 8]" />
        </TresMesh>
      </TresGroup>
      <TresGroup ref="armR" :position="[0.34, 1.44, 0]">
        <TresMesh :position="[0, -0.28, 0]" :material="shirtMat">
          <TresCylinderGeometry :args="[0.07, 0.08, 0.52, 8]" />
        </TresMesh>
        <TresMesh :position="[0, -0.6, 0]" :material="skinMat">
          <TresSphereGeometry :args="[0.08, 8, 8]" />
        </TresMesh>
      </TresGroup>

      <!-- head -->
      <TresMesh :position="[0, 1.78, 0]" :material="skinMat">
        <TresSphereGeometry :args="[0.24, 14, 14]" />
      </TresMesh>
      <TresMesh :position="[0, 1.87, -0.03]" :material="hairMat">
        <TresSphereGeometry :args="[0.235, 12, 10, 0, Math.PI * 2, 0, 1.25]" />
      </TresMesh>
      <!-- kufi / hijab -->
      <TresMesh v-if="props.kufi && !props.hijab" :position="[0, 1.99, 0]" :material="hatMat">
        <TresCylinderGeometry :args="[0.25, 0.27, 0.13, 12]" />
      </TresMesh>
      <TresMesh v-if="props.hijab" :position="[0, 1.8, 0]" :material="hatMat">
        <TresSphereGeometry :args="[0.29, 14, 14]" />
      </TresMesh>
    </TresGroup>
  </TresGroup>
</template>
