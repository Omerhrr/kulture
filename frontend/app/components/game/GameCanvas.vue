<script setup lang="ts">
// GameCanvas - TresJS canvas + lighting + the full Kaduna city + avatars.
// NOTE: anything using useLoop must be a CHILD of TresCanvas
// (see CameraRig / SunLight / PlayerAvatar / NpcAvatar).

import { getQuality, perf } from '~/utils/quality'
const world = useWorldStore()
const low = getQuality() === 'low'

// Staggered mounting: the city, sky and player appear first; the heavy
// systems (crowds, traffic, grass, interiors...) come in one per tick so a
// mid-range phone never builds everything in a single long frame.
const stage = ref(0)
let stageTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  stageTimer = setInterval(() => {
    stage.value++
    ;(window as any).__kk_stage = stage.value
    if (stage.value >= 12 && stageTimer) clearInterval(stageTimer)
  }, perf().stagger)
})
onUnmounted(() => stageTimer && clearInterval(stageTimer))

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
  <TresCanvas :shadows="!low" :shadow-map-type="2" :tone-mapping="4" :tone-mapping-exposure="1.0" :output-color-space="'srgb'" :dpr="low ? 1 : [1, 1.5]" :clear-color="'#9ec7de'">
    <CameraRig />
    <ShaderWarmup :stage="stage" />
    <PointerControls />
    <TresFog :args="['#d3dfe6', 140, 4600]" />
    <SkyDome />
    <EnvLight />
    <Weather v-if="stage >= 1" />

    <DayNight />
    <TresAmbientLight :intensity="0.72" color="#fff4e0" />
    <SunLight />
    <TresHemisphereLight :args="['#d4e6f4', '#a89a72', 1.0]" />

    <KadunaCity />
    <GrassField v-if="stage >= 2" />
    <WorldScene />
    <CrowdSystem v-if="stage >= 3" />
    <TrafficSystem v-if="stage >= 4" />
    <RideSystem v-if="stage >= 4" />
    <Interiors v-if="stage >= 5" />
    <PlayerAvatar />
    <RemotePlayers v-if="stage >= 1" />
    <CrowdLOD v-if="stage >= 6" />
    <Parks v-if="stage >= 6" />
    <AdScreens v-if="stage >= 7" />
    <MapProjector v-if="stage >= 7" />
    <Commute v-if="stage >= 8" />
    <RaceSystem v-if="stage >= 8" />
    <SocialScenes v-if="stage >= 9" />
    <Landmarks v-if="stage >= 9" />
    <CityEvents v-if="stage >= 10" />
    <PlayerBusinesses v-if="stage >= 10" />
    <CrewClubhouse v-if="stage >= 10" />
    <CarParks v-if="stage >= 10" />
    <AmbientHeli v-if="stage >= 11" />
    <template v-if="stage >= 5"><NpcAvatar v-for="n in npcs" :key="n.code" :x="n.x" :z="n.z" :name="n.code" :female="n.female" :shirt="n.shirt" :hair-style="n.hairStyle" :beard="n.beard" /></template>
  </TresCanvas>
</template>
