<script setup lang="ts">
// GameCanvas - TresJS canvas + lighting + the full Kaduna city + avatars.
// NOTE: anything using useLoop must be a CHILD of TresCanvas
// (see CameraRig / SunLight / PlayerAvatar / NpcAvatar).

import { getQuality } from '~/utils/quality'
const world = useWorldStore()
const low = getQuality() === 'low'

// Distinct look per server NPC (positions come from the world store).
const NPC_LOOKS: Record<string, { female?: boolean; shirt: string; hairStyle?: 'cap' | 'afro' | 'braids' | 'bald'; beard?: boolean }> = {
  npc_musa: { shirt: '#efe8d6', hairStyle: 'cap', beard: true },
  npc_amina: { female: true, shirt: '#3f6fae', hairStyle: 'braids' },
  npc_mama_chidi: { female: true, shirt: '#8a3a5a', hairStyle: 'braids' },
  npc_bashir: { shirt: '#2e7d5b', hairStyle: 'cap', beard: true },
  npc_prof_danjuma: { shirt: '#4a6a8a', hairStyle: 'afro', beard: true },
  npc_tunde: { shirt: '#c47a2a', hairStyle: 'cap' },
  npc_ngozi: { female: true, shirt: '#a84a6a', hairStyle: 'braids' }
}
const npcs = computed(() =>
  world.npcEntities
    .filter((e) => NPC_LOOKS[e.code])
    .map((e) => ({ code: e.code, x: e.position[0], z: e.position[2], ...NPC_LOOKS[e.code] }))
)

// mount telemetry (headless debugging)
onMounted(() => {
  const w = window as any
  w.__kk_canvas_mounts = (w.__kk_canvas_mounts || 0) + 1
})
onUnmounted(() => {
  const w = window as any
  w.__kk_canvas_unmounts = (w.__kk_canvas_unmounts || 0) + 1
})
if (import.meta.dev) {
  ;(window as any).__kk_npcs = () => npcs.value.map((n) => n.code)
}
</script>

<template>
  <TresCanvas :shadows="!low" :shadow-map-type="2" :tone-mapping-exposure="1.05" :dpr="low ? 1 : [1, 1.5]" :clear-color="'#9ec7de'">
    <CameraRig />
    <PointerControls />
    <TresFog :args="['#9ec7de', 550, 2600]" />
    <EnvLight />
    <Weather />

    <DayNight />
    <TresAmbientLight :intensity="0.72" color="#fff4e0" />
    <SunLight />
    <TresHemisphereLight :args="['#bfd9e8', '#8a7d5a', 0.5]" />

    <KadunaCity />
    <WorldScene />
    <CrowdSystem />
    <TrafficSystem />
    <RideSystem />
    <Interiors />
    <PlayerAvatar />
    <RemotePlayers />
    <CrowdLOD />
    <AdScreens />
    <MapProjector />
    <Commute />
    <NpcAvatar v-for="n in npcs" :key="n.code" :x="n.x" :z="n.z" :name="n.code" :female="n.female" :shirt="n.shirt" :hair-style="n.hairStyle" :beard="n.beard" />
  </TresCanvas>
</template>
