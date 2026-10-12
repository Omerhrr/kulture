<script setup lang="ts">
// Publishes the active camera + canvas element for the HTML city map.
import { view } from '~/utils/mapProject'

const ctx = useTresContext() as any
const { onBeforeRender } = useLoop()
onBeforeRender(() => {
  view.cam = ctx.camera?.activeCamera?.value ?? null
  const r = ctx.renderer?.instance ?? ctx.renderer?.value
  view.el = r?.domElement ?? view.el
  // fallback: the WebGL canvas is the big one (minimap/map are 2D canvases)
  if (!view.el) {
    let best: HTMLCanvasElement | null = null
    for (const c of Array.from(document.querySelectorAll('canvas'))) if (!best || c.clientWidth * c.clientHeight > best.clientWidth * best.clientHeight) best = c
    view.el = best
  }
})
if (import.meta.dev && typeof window !== 'undefined') (window as any).__kk_view = () => ({ cam: !!view.cam, el: view.el?.tagName, w: view.el?.clientWidth })
</script>

<template>
  <TresGroup />
</template>
