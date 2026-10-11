<script setup lang="ts">
// WorldScene - the server-owned playable entities: Musa's store, the
// QuickPOS kiosk, Central Market sheds, Arewa House, Stonetech Square and
// the keke stop. Positions come from the backend (world store), so the
// game geometry always matches the authoritative world.
//
// The rest of the city (roads, river, districts, landmarks) renders in
// KadunaCity.vue from the baked OSM layout.

import * as THREE from 'three'
import { makeSignTexture, makeLabelTexture } from '~/utils/sign'
import { PLAYABLE_POS } from '~/utils/kaduna'

const world = useWorldStore()

const wallMusa = new THREE.MeshStandardMaterial({ color: '#7C4A2D', roughness: 0.85 })
const roofMusa = new THREE.MeshStandardMaterial({ color: '#c8c2b6', roughness: 0.6, metalness: 0.25 })
const wallArewa = new THREE.MeshStandardMaterial({ color: '#c9b18a', roughness: 0.8 })
const wallShed = new THREE.MeshStandardMaterial({ color: '#5d6e46', roughness: 0.9 })
const awning1 = new THREE.MeshStandardMaterial({ color: '#b8433a', roughness: 0.8 })
const awning2 = new THREE.MeshStandardMaterial({ color: '#e8b84b', roughness: 0.8 })
const woodMat = new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.95 })
const glassMat = new THREE.MeshStandardMaterial({ color: '#2b4a52', roughness: 0.2, metalness: 0.4 })
const kekeYellow = new THREE.MeshStandardMaterial({ color: '#e6b93c', roughness: 0.4, metalness: 0.3 })
const kekeBlack = new THREE.MeshStandardMaterial({ color: '#22252a', roughness: 0.6 })
const stoneMat = new THREE.MeshStandardMaterial({ color: '#8d8d94', roughness: 0.8 })
const padMat = new THREE.MeshStandardMaterial({ color: '#a89f85', roughness: 1 })

const neonMusa = new THREE.MeshBasicMaterial({ map: makeSignTexture('MUSA PROVISIONS', { bg: '#123528', sub: 'EST. 1998' }) })
const neonPos = new THREE.MeshBasicMaterial({ map: makeSignTexture('AREWA QuickPOS', { bg: '#0b2f3a', sub: 'LIGHTNING' }) })
const neonMarket = new THREE.MeshBasicMaterial({ map: makeSignTexture('KADUNA CENTRAL MARKET', { bg: '#2f3a1b', sub: 'Kantin Kasuwa' }) })
const neonArewa = new THREE.MeshBasicMaterial({ map: makeSignTexture('AREWA HOUSE', { bg: '#3a2b12', sub: 'Gidan Arewa' }) })
const neonStone = new THREE.MeshBasicMaterial({ map: makeSignTexture('STONETECH SQUARE', { bg: '#23272e', sub: 'Community Plaza' }) })
const neonKeke = new THREE.MeshBasicMaterial({ map: makeSignTexture('KEKE STOP', { bg: '#123528' }) })

// market shed grid relative to the market entity position
const SHEDS: Array<[number, number, number]> = []
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 6; c++) {
    SHEDS.push([-21 + c * 8.4, -12 + r * 8, r % 2])
  }
}

function entityByCode(code: string) {
  return world.entities.find((e) => e.code === code)
}

/** Server entity position as [x, 0, z] with the baked-map fallback. */
const pos3 = (code: string, fallback: [number, number]): [number, number, number] => {
  const e = entityByCode(code)
  return e ? [e.position[0], 0, e.position[2]] : [fallback[0], 0, fallback[1]]
}

// floating name labels (billboard sprites above each playable spot)
const labels = computed(() => {
  const out: Array<{ pos: [number, number, number]; text: string; tex: THREE.CanvasTexture; w: number }> = []
  const defs: Array<[string, string, number]> = [
    ['musa_shop', "Musa's Provision Store", 24],
    ['arewa_pos', 'Arewa QuickPOS', 20],
    ['kaduna_central_market', 'Kaduna Central Market', 30],
    ['arewa_house', 'Arewa House', 22],
    ['stonetech_square', 'Stonetech Square', 22],
    ['keke_stop', 'Keke Napep Stop', 18]
  ]
  for (const [code, name, w] of defs) {
    const e = entityByCode(code)
    const p: [number, number] = e ? [e.position[0], e.position[2]] : (PLAYABLE_POS[code] as [number, number]) ?? [0, 0]
    out.push({
      pos: [p[0], 26, p[1]],
      text: name,
      tex: makeLabelTexture(name, '#ffe9a8'),
      w
    })
  }
  return out
})
</script>

<template>
  <TresGroup>
    <!-- Musa's Provision Store -->
    <TresGroup :position="pos3('musa_shop', [-70, 75])">
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
      <TresMesh :position="[0, 3.9, 6.2]" :rotation="[0.5, 0, 0]" :material="awning1" cast-shadow>
        <TresBoxGeometry :args="[11, 0.12, 2.6]" />
      </TresMesh>
    </TresGroup>

    <!-- Arewa QuickPOS kiosk -->
    <TresGroup :position="pos3('arewa_pos', [-25, 8])">
      <TresMesh :position="[0, 1.4, 0]" cast-shadow :material="wallArewa">
        <TresBoxGeometry :args="[3.4, 2.8, 3.4]" />
      </TresMesh>
      <TresMesh :position="[0, 3.0, 0]" cast-shadow :material="kekeYellow">
        <TresConeGeometry :args="[2.9, 1.1, 4]" :rotation="[0, Math.PI / 4, 0]" />
      </TresMesh>
      <TresMesh :position="[0, 2.0, 1.75]" :material="neonPos">
        <TresPlaneGeometry :args="[3.1, 1.0]" />
      </TresMesh>
      <TresMesh :position="[0, 1.4, 1.72]" :material="neonPos">
        <TresPlaneGeometry :args="[1.4, 1.4]" />
      </TresMesh>
    </TresGroup>

    <!-- Kaduna Central Market: open shed grid -->
    <TresGroup :position="pos3('kaduna_central_market', [-80, 102])">
      <TresMesh :position="[0, 0.04, 0]" receive-shadow :material="padMat">
        <TresBoxGeometry :args="[48, 0.08, 36]" />
      </TresMesh>
      <TresGroup v-for="(s, i) in SHEDS" :key="'shed' + i">
        <TresMesh :position="[s[0], 1.3, s[1]]" cast-shadow :material="wallShed">
          <TresBoxGeometry :args="[6.4, 2.6, 5.2]" />
        </TresMesh>
        <TresMesh :position="[s[0], 2.85, s[1]]" cast-shadow :material="s[2] === 0 ? awning1 : awning2">
          <TresBoxGeometry :args="[7.2, 0.3, 6.2]" />
        </TresMesh>
      </TresGroup>
      <TresMesh :position="[0, 8.4, -14]" :material="neonMarket">
        <TresPlaneGeometry :args="[16, 2]" />
      </TresMesh>
      <TresMesh v-for="p in 2" :key="'mpole' + p" :position="[-7.6 + (p - 1) * 15.2, 4, -14]" :material="woodMat">
        <TresCylinderGeometry :args="[0.18, 0.24, 8, 8]" />
      </TresMesh>
    </TresGroup>

    <!-- Arewa House landmark -->
    <TresGroup :position="pos3('arewa_house', [-20, -164])">
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
    <TresGroup :position="pos3('stonetech_square', [-55, 360])">
      <TresMesh :position="[0, 0.08, 0]" receive-shadow :material="stoneMat">
        <TresCylinderGeometry :args="[11, 11, 0.16, 28]" />
      </TresMesh>
      <TresMesh :position="[0, 1.5, 0]" cast-shadow :material="stoneMat">
        <TresCylinderGeometry :args="[0.7, 1.1, 3, 10]" />
      </TresMesh>
      <TresMesh :position="[0, 3.3, 0]" cast-shadow :material="kekeYellow">
        <TresOctahedronGeometry :args="[0.8]" />
      </TresMesh>
      <TresMesh :position="[0, 5.6, 0]" :material="neonStone">
        <TresPlaneGeometry :args="[9, 1.5]" />
      </TresMesh>
    </TresGroup>

    <!-- Keke stop + keke prop -->
    <TresGroup :position="pos3('keke_stop', [-245, 420])">
      <TresMesh :position="[-3.5, 3.4, 0]" :material="neonKeke">
        <TresPlaneGeometry :args="[5, 1.1]" />
      </TresMesh>
      <TresMesh :position="[-3.5, 2.6, -2.4]" cast-shadow :material="woodMat">
        <TresCylinderGeometry :args="[0.14, 0.14, 5.2, 8]" />
      </TresMesh>
      <TresMesh :position="[-3.5, 2.6, 2.4]" cast-shadow :material="woodMat">
        <TresCylinderGeometry :args="[0.14, 0.14, 5.2, 8]" />
      </TresMesh>
      <TresMesh :position="[-3.5, 4.1, 0]" :rotation="[Math.PI / 2, 0, 0]" :material="awning2" cast-shadow>
        <TresBoxGeometry :args="[6.4, 5.4, 0.12]" />
      </TresMesh>
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

    <!-- floating name labels -->
    <TresSprite v-for="(l, i) in labels" :key="'lbl' + i" :position="l.pos" :scale="[l.w, l.w * 0.1875, 1]">
      <TresSpriteMaterial :map="l.tex" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
