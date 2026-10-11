<script setup lang="ts">
// Shared character (player + NPCs) with an articulated rig and a real
// face: eyes with pupils, brows, a nose, a mouth, ears, four hair styles,
// an optional beard, plus the kufi / hijab. Legs and arms swing around
// hip/shoulder pivots so walking reads as a human gait. Animation modes:
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
    hairStyle?: 'cap' | 'afro' | 'braids' | 'bald'
    hairColor?: string
    beard?: boolean
    scale?: number
    mode?: 'idle' | 'walk' | 'sit'
    gaitSpeed?: number
    phase?: number
  }>(),
  {
    shirt: '#2e7d5b',
    trouser: '#2b3440',
    skin: '#8a5a3b',
    kufi: true,
    hijab: false,
    hairStyle: 'cap',
    hairColor: '#17141a',
    beard: false,
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
const hairMat = new THREE.MeshStandardMaterial({ color: props.hairColor, roughness: 0.95 })
const eyeMat = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.35 })
const pupilMat = new THREE.MeshStandardMaterial({ color: '#191210', roughness: 0.3 })
const browMat = new THREE.MeshStandardMaterial({ color: props.hairColor, roughness: 0.95 })
const lipMat = new THREE.MeshStandardMaterial({ color: '#6a3a30', roughness: 0.85 })
const earMat = new THREE.MeshStandardMaterial({ color: props.skin, roughness: 0.7 })

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
    l.rotation.x = s * 0.62
    r.rotation.x = -s * 0.62
    l.rotation.z = 0
    r.rotation.z = 0
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
    // idle: breathing + weight shift + occasional blink
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
        <TresSphereGeometry :args="[0.24, 16, 14]" />
      </TresMesh>
      <!-- ears -->
      <TresMesh :position="[-0.23, 1.78, 0]" :material="earMat">
        <TresSphereGeometry :args="[0.06, 6, 6]" />
      </TresMesh>
      <TresMesh :position="[0.23, 1.78, 0]" :material="earMat">
        <TresSphereGeometry :args="[0.06, 6, 6]" />
      </TresMesh>

      <!-- face (front is +z) -->
      <TresMesh :position="[-0.088, 1.845, 0.195]" :material="eyeMat">
        <TresSphereGeometry :args="[0.052, 8, 7]" />
      </TresMesh>
      <TresMesh :position="[0.088, 1.845, 0.195]" :material="eyeMat">
        <TresSphereGeometry :args="[0.052, 8, 7]" />
      </TresMesh>
      <TresMesh :position="[-0.088, 1.845, 0.238]" :material="pupilMat">
        <TresSphereGeometry :args="[0.026, 6, 6]" />
      </TresMesh>
      <TresMesh :position="[0.088, 1.845, 0.238]" :material="pupilMat">
        <TresSphereGeometry :args="[0.026, 6, 6]" />
      </TresMesh>
      <TresMesh :position="[-0.088, 1.91, 0.205]" :material="browMat">
        <TresBoxGeometry :args="[0.1, 0.024, 0.03]" />
      </TresMesh>
      <TresMesh :position="[0.088, 1.91, 0.205]" :material="browMat">
        <TresBoxGeometry :args="[0.1, 0.024, 0.03]" />
      </TresMesh>
      <TresMesh :position="[0, 1.785, 0.235]" :material="skinMat">
        <TresConeGeometry :args="[0.04, 0.1, 5]" />
      </TresMesh>
      <TresMesh :position="[0, 1.7, 0.212]" :material="lipMat">
        <TresBoxGeometry :args="[0.11, 0.03, 0.03]" />
      </TresMesh>
      <!-- beard -->
      <TresMesh v-if="props.beard && !props.hijab" :position="[0, 1.66, 0.12]" :material="hairMat">
        <TresSphereGeometry :args="[0.19, 10, 8, 0, Math.PI * 2, 0.9, 1.1]" />
      </TresMesh>

      <!-- hair styles -->
      <template v-if="!props.hijab">
        <TresMesh v-if="props.hairStyle === 'cap'" :position="[0, 1.87, -0.02]" :material="hairMat">
          <TresSphereGeometry :args="[0.25, 12, 10, 0, Math.PI * 2, 0, 1.3]" />
        </TresMesh>
        <TresMesh v-else-if="props.hairStyle === 'afro'" :position="[0, 1.9, -0.02]" :material="hairMat">
          <TresSphereGeometry :args="[0.3, 12, 10]" />
        </TresMesh>
        <TresMesh v-else-if="props.hairStyle === 'braids'" :position="[0, 1.87, -0.02]" :material="hairMat">
          <TresSphereGeometry :args="[0.25, 12, 10, 0, Math.PI * 2, 0, 1.3]" />
        </TresMesh>
        <TresMesh v-if="props.hairStyle === 'braids'" :position="[0, 1.68, -0.2]" :material="hairMat">
          <TresBoxGeometry :args="[0.2, 0.4, 0.12]" />
        </TresMesh>
        <!-- bald: nothing -->
      </template>
      <!-- kufi / hijab -->
      <TresMesh v-if="props.kufi && !props.hijab" :position="[0, 2.0, 0]" :material="hatMat">
        <TresCylinderGeometry :args="[0.25, 0.27, 0.13, 12]" />
      </TresMesh>
      <TresMesh v-if="props.hijab" :position="[0, 1.8, 0]" :material="hatMat">
        <TresSphereGeometry :args="[0.29, 14, 14]" />
      </TresMesh>
    </TresGroup>
  </TresGroup>
</template>
