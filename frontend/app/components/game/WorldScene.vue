<script setup lang="ts">
// WorldScene - the compact Kaduna neighborhood, manually modeled from
// primitives (approximate geometry; NOT survey data - see docs).
// Entities come from the authoritative backend (world store), so positions
// and interaction radii are server-owned.

import * as THREE from 'three'
import { makeSignTexture } from '~/utils/sign'

const world = useWorldStore()

const ground = new THREE.MeshStandardMaterial({ color: '#8a7d5a', roughness: 1 })
const roadMat = new THREE.MeshStandardMaterial({ color: '#3b3b40', roughness: 0.9 })
const sideMat = new THREE.MeshStandardMaterial({ color: '#a49a80', roughness: 1 })
const wallMusa = new THREE.MeshStandardMaterial({ color: '#7C4A2D', roughness: 0.85 })
const roofMusa = new THREE.MeshStandardMaterial({ color: '#c8c2b6', roughness: 0.6, metalness: 0.25 })
const wallArewa = new THREE.MeshStandardMaterial({ color: '#c9b18a', roughness: 0.8 })
const wallMarket = new THREE.MeshStandardMaterial({ color: '#5d6e46', roughness: 0.9 })
const awning1 = new THREE.MeshStandardMaterial({ color: '#b8433a', roughness: 0.8 })
const awning2 = new THREE.MeshStandardMaterial({ color: '#e8b84b', roughness: 0.8 })
const woodMat = new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.95 })
const glassMat = new THREE.MeshStandardMaterial({ color: '#2b4a52', roughness: 0.2, metalness: 0.4 })
const kekeYellow = new THREE.MeshStandardMaterial({ color: '#e6b93c', roughness: 0.4, metalness: 0.3 })
const kekeBlack = new THREE.MeshStandardMaterial({ color: '#22252a', roughness: 0.6 })
const palmTrunk = new THREE.MeshStandardMaterial({ color: '#7a5c3a', roughness: 1 })
const palmLeaf = new THREE.MeshStandardMaterial({ color: '#3f7d3a', roughness: 0.9 })
const stoneMat = new THREE.MeshStandardMaterial({ color: '#8d8d94', roughness: 0.8 })
const neonMusa = new THREE.MeshBasicMaterial({ map: makeSignTexture('MUSA PROVISIONS', { bg: '#123528', sub: 'EST. 1998' }) })
const neonPos = new THREE.MeshBasicMaterial({ map: makeSignTexture('AREWA QuickPOS', { bg: '#0b2f3a', sub: '⚡ LIGHTNING' }) })
const neonMarket = new THREE.MeshBasicMaterial({ map: makeSignTexture('KADUNA CENTRAL MARKET', { bg: '#2f3a1b', sub: 'Kantin Kasuwa' }) })
const neonArewa = new THREE.MeshBasicMaterial({ map: makeSignTexture('AREWA HOUSE', { bg: '#3a2b12', sub: 'Gidan Arewa' }) })
const neonStone = new THREE.MeshBasicMaterial({ map: makeSignTexture('STONETECH SQUARE', { bg: '#23272e', sub: 'Community Plaza' }) })
const neonKeke = new THREE.MeshBasicMaterial({ map: makeSignTexture('KEKE STOP', { bg: '#123528' }) })

const stalls = [
  { x: 26, z: -28, c: 0 },
  { x: 34, z: -30, c: 1 },
  { x: 42, z: -27, c: 0 },
  { x: 28, z: -18, c: 1 },
  { x: 38, z: -17, c: 0 }
]
const palms = [
  [-14, 22], [-2, 14], [10, 34], [24, 36], [-30, 6], [46, 8], [-46, -8], [8, -34]
]

function entityByCode(code: string) {
  return world.entities.find((e) => e.code === code)
}

/** Server entity position as [x, 0, z] with a fallback. */
const pos3 = (code: string, fallback: [number, number]): [number, number, number] => {
  const e = entityByCode(code)
  return e ? [e.position[0], 0, e.position[2]] : [fallback[0], 0, fallback[1]]
}
</script>

<template>
  <TresGroup>
    <!-- ground + road + sidewalks -->
    <TresMesh :position="[0, -0.05, 0]" :rotation="[-Math.PI / 2, 0, 0]" receive-shadow :material="ground">
      <TresPlaneGeometry :args="[220, 220]" />
    </TresMesh>
    <TresMesh :position="[0, 0.01, 8]" receive-shadow :material="roadMat">
      <TresBoxGeometry :args="[16, 0.04, 150]" />
    </TresMesh>
    <TresMesh :position="[-9.6, 0.06, 8]" receive-shadow :material="sideMat">
      <TresBoxGeometry :args="[3.2, 0.08, 150]" />
    </TresMesh>
    <TresMesh :position="[9.6, 0.06, 8]" receive-shadow :material="sideMat">
      <TresBoxGeometry :args="[3.2, 0.08, 150]" />
    </TresMesh>
    <TresGroup v-for="i in 9" :key="'dash' + i">
      <TresMesh :position="[0, 0.05, -60 + i * 16]" :material="awning2">
        <TresBoxGeometry :args="[0.6, 0.02, 6]" />
      </TresMesh>
    </TresGroup>

    <!-- Musa's Provision Store -->
    <TresGroup :position="pos3('musa_shop', [-20, -12])">
      <TresMesh :position="[0, 2.2, 0]" cast-shadow :material="wallMusa">
        <TresBoxGeometry :args="[14, 4.4, 10]" />
      </TresMesh>
      <TresMesh :position="[0, 4.7, 0.6]" cast-shadow :material="roofMusa">
        <TresBoxGeometry :args="[15, 0.4, 11.4]" />
      </TresMesh>
      <TresMesh :position="[0, 2.6, 5.05]" :material="glassMat">
        <TresBoxGeometry :args="[9, 2.2, 0.2]" />
      </TresMesh>
      <TresMesh :position="[0, 5.6, 5.1]" :material="neonMusa">
        <TresPlaneGeometry :args="[10, 1.6]" />
      </TresMesh>
      <!-- awning -->
      <TresMesh :position="[0, 3.9, 6.2]" :rotation="[0.5, 0, 0]" :material="awning1" cast-shadow>
        <TresBoxGeometry :args="[11, 0.12, 2.6]" />
      </TresMesh>
    </TresGroup>

    <!-- Arewa QuickPOS kiosk -->
    <TresGroup :position="pos3('arewa_pos', [0, -20])">
      <TresMesh :position="[0, 1.4, 0]" cast-shadow :material="wallArewa">
        <TresBoxGeometry :args="[3.4, 2.8, 3.4]" />
      </TresMesh>
      <TresMesh :position="[0, 3.0, 0]" cast-shadow :material="kekeYellow">
        <TresConeGeometry :args="[2.9, 1.1, 4]" :rotation="[0, Math.PI / 4, 0]" />
      </TresMesh>
      <TresMesh :position="[0, 2.0, 1.75]" :material="neonPos">
        <TresPlaneGeometry :args="[3.1, 1.0]" />
      </TresMesh>
      <!-- QR panel -->
      <TresMesh :position="[0, 1.4, 1.72]" :material="neonPos">
        <TresPlaneGeometry :args="[1.4, 1.4]" />
      </TresMesh>
    </TresGroup>

    <!-- Kaduna Central Market: stalls with striped awnings -->
    <TresGroup v-for="(s, i) in stalls" :key="'stall' + i">
      <TresMesh :position="[s.x, 1.1, s.z]" cast-shadow :material="woodMat">
        <TresBoxGeometry :args="[5.5, 2.2, 4]" />
      </TresMesh>
      <TresMesh :position="[s.x, 2.5, s.z + 0.5]" :rotation="[0.45, 0, 0]" cast-shadow
        :material="s.c === 0 ? awning1 : awning2">
        <TresBoxGeometry :args="[6.2, 0.1, 3.2]" />
      </TresMesh>
      <TresMesh :position="[s.x, 1.2, s.z + 2.1]" :material="woodMat">
        <TresBoxGeometry :args="[5.5, 2.0, 0.15]" />
      </TresMesh>
    </TresGroup>
    <TresMesh :position="pos3('kaduna_central_market', [32, -38])" :material="neonMarket">
      <TresPlaneGeometry :args="[14, 1.8]" />
    </TresMesh>

    <!-- AREWA House landmark -->
    <TresGroup :position="pos3('arewa_house', [-40, -36])">
      <TresMesh :position="[0, 7, 0]" cast-shadow :material="wallArewa">
        <TresBoxGeometry :args="[16, 14, 12]" />
      </TresMesh>
      <TresMesh :position="[0, 14.6, 0]" cast-shadow :material="stoneMat">
        <TresBoxGeometry :args="[17, 1.2, 13]" />
      </TresMesh>
      <TresMesh :position="[0, 6, 6.1]" :material="glassMat">
        <TresBoxGeometry :args="[10, 8, 0.2]" />
      </TresMesh>
      <TresMesh :position="[0, 15.6, 6.2]" :material="neonArewa">
        <TresPlaneGeometry :args="[12, 1.7]" />
      </TresMesh>
      <TresMesh v-for="c in 4" :key="'col' + c" :position="[-6 + (c - 1) * 4, 2.6, 6.4]" cast-shadow :material="stoneMat">
        <TresCylinderGeometry :args="[0.5, 0.55, 5.2, 10]" />
      </TresMesh>
    </TresGroup>

    <!-- Stonetech Square: gathering plaza -->
    <TresGroup :position="pos3('stonetech_square', [36, 24])">
      <TresMesh :position="[0, 0.08, 0]" receive-shadow :material="stoneMat">
        <TresCylinderGeometry :args="[9, 9, 0.16, 28]" />
      </TresMesh>
      <TresMesh :position="[0, 1.5, 0]" cast-shadow :material="stoneMat">
        <TresCylinderGeometry :args="[0.7, 1.1, 3, 10]" />
      </TresMesh>
      <TresMesh :position="[0, 3.3, 0]" cast-shadow :material="kekeYellow">
        <TresOctahedronGeometry :args="[0.8]" />
      </TresMesh>
      <TresMesh :position="[0, 5.4, 0]" :material="neonStone">
        <TresPlaneGeometry :args="[9, 1.5]" />
      </TresMesh>
    </TresGroup>

    <!-- Keke stop + keke prop -->
    <TresGroup :position="pos3('keke_stop', [-8, 30])">
      <TresMesh :position="[0, 3.4, 0]" :material="neonKeke">
        <TresPlaneGeometry :args="[5, 1.1]" />
      </TresMesh>
      <TresMesh :position="[-2.5, 2.6, 0]" cast-shadow :material="woodMat">
        <TresCylinderGeometry :args="[0.14, 0.14, 5.2, 8]" />
      </TresMesh>
      <!-- keke napep -->
      <TresGroup :position="[3.2, 0, 1.5]" :rotation="[0, -0.7, 0]">
        <TresMesh :position="[0, 1.1, 0]" cast-shadow :material="kekeYellow">
          <TresBoxGeometry :args="[1.7, 1.3, 2.4]" />
        </TresMesh>
        <TresMesh :position="[0, 1.15, 1.05]" :material="kekeBlack">
          <TresBoxGeometry :args="[1.4, 0.9, 0.5]" />
        </TresMesh>
        <TresMesh :position="[0, 0.35, 1.2]" cast-shadow :material="kekeBlack">
          <TresCylinderGeometry :args="[0.35, 0.35, 0.25, 12]" :rotation="[Math.PI / 2, 0, 0]" />
        </TresMesh>
        <TresMesh :position="[-0.85, 0.35, -0.7]" cast-shadow :material="kekeBlack">
          <TresCylinderGeometry :args="[0.35, 0.35, 0.25, 12]" :rotation="[Math.PI / 2, 0, 0]" />
        </TresMesh>
        <TresMesh :position="[0.85, 0.35, -0.7]" cast-shadow :material="kekeBlack">
          <TresCylinderGeometry :args="[0.35, 0.35, 0.25, 12]" :rotation="[Math.PI / 2, 0, 0]" />
        </TresMesh>
      </TresGroup>
    </TresGroup>

    <!-- palms -->
    <TresGroup v-for="(p, i) in palms" :key="'palm' + i">
      <TresMesh :position="[p[0], 2.2, p[1]]" cast-shadow :material="palmTrunk">
        <TresCylinderGeometry :args="[0.22, 0.34, 4.4, 8]" />
      </TresMesh>
      <TresMesh :position="[p[0], 4.7, p[1]]" cast-shadow :material="palmLeaf">
        <TresConeGeometry :args="[1.7, 1.6, 7]" />
      </TresMesh>
      <TresMesh :position="[p[0], 4.1, p[1]]" :material="palmLeaf">
        <TresConeGeometry :args="[2.1, 1.2, 7]" />
      </TresMesh>
    </TresGroup>

    <!-- streetlights -->
    <TresGroup v-for="i in 5" :key="'lamp' + i">
      <TresMesh :position="[-8.2, 2.6, -50 + i * 26]" :material="kekeBlack">
        <TresCylinderGeometry :args="[0.1, 0.14, 5.2, 8]" />
      </TresMesh>
      <TresMesh :position="[-8.2, 5.2, -50 + i * 26]" :material="kekeYellow">
        <TresSphereGeometry :args="[0.3, 10, 10]" />
      </TresMesh>
      <TresMesh :position="[8.2, 2.6, -38 + i * 26]" :material="kekeBlack">
        <TresCylinderGeometry :args="[0.1, 0.14, 5.2, 8]" />
      </TresMesh>
      <TresMesh :position="[8.2, 5.2, -38 + i * 26]" :material="kekeYellow">
        <TresSphereGeometry :args="[0.3, 10, 10]" />
      </TresMesh>
    </TresGroup>
  </TresGroup>
</template>
