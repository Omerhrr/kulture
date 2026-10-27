<script setup lang="ts">
// ShaderWarmup - stops the "freeze when something new comes into view" lag.
//
// three.js compiles a GPU program the first time each kind of material is
// drawn, and by default then blocks on the compile result to check it for
// errors (getProgramInfoLog). In a big city that happens again and again as
// cars, people and buildings come into view, freezing the frame each time.
//  - production: skip the blocking error check (dev builds keep it)
//  - once every system has mounted, compile all the scene's materials in
//    the background (KHR_parallel_shader_compile) so they're ready before
//    they're ever on screen, then repeat once for things that load late.
const ctx = useTresContext() as any
const props = defineProps<{ stage: number }>()

function parts() {
  const unwrap = (v: any) => v?.value ?? v?.instance ?? v
  const renderer = unwrap(ctx.renderer)
  return { renderer: renderer?.instance ?? renderer, scene: unwrap(ctx.scene), camera: unwrap(ctx.camera?.activeCamera ?? ctx.camera) }
}

onMounted(() => {
  const { renderer } = parts()
  if (renderer?.debug && !import.meta.dev) renderer.debug.checkShaderErrors = false
})

let warmed = 0
async function warm() {
  const { renderer, scene, camera } = parts()
  if (!renderer?.compileAsync || !scene || !camera?.isCamera) return
  // without parallel compiling the warm-up would be one big freeze right
  // after the game appears: leave those devices to compile as they go
  if (!renderer.extensions?.has?.('KHR_parallel_shader_compile')) return
  const t = performance.now()
  try {
    await renderer.compileAsync(scene, camera)
  } catch {}
  warmed++
  if (import.meta.dev) console.info(`[kk] shaders warmed (${warmed}) in ${Math.round(performance.now() - t)} ms, programs=${renderer.info?.programs?.length}`)
}
let started = false
watch(
  () => props.stage,
  (s: number) => {
    if (started || s < 12) return
    started = true
    const ric = (window as any).requestIdleCallback as ((f: () => void) => number) | undefined
    if (ric) ric(() => warm())
    else setTimeout(warm, 0)
    setTimeout(warm, 8000) // late arrivals: interiors, remote players, ads
  },
  { immediate: true }
)
if (import.meta.dev) (window as any).__kk_programs = () => parts().renderer?.info?.programs?.length ?? -1
</script>

<template>
  <TresGroup />
</template>
