<script setup lang="ts">
// MapOverlay - the full city map (M key or the HUD button): every road,
// the river and dam, rail, runway, tall towers, farms, open houses and
// landmarks. Tap anywhere to set a walking waypoint.
import { getMapCanvas, mapTransform, mapToWorld, worldToMap } from '~/utils/kadunaMap'
import { useMapOpen } from '~/composables/useControlsState'
import { clampBounds } from '~/utils/collision'
import { unstick } from '~/utils/collision'

const open = useMapOpen()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const world = useWorldStore()
const moveTarget = useMoveTarget()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)

watch(open, async (v) => {
  if (v) {
    await nextTick()
    draw()
  }
})

function draw() {
  const cv = canvasRef.value
  const wrap = wrapRef.value
  if (!cv || !wrap) return
  const src = getMapCanvas()
  const maxW = Math.min(window.innerWidth * 0.92, 1100)
  const maxH = window.innerHeight * 0.78
  const scale = Math.min(maxW / src.width, maxH / src.height)
  cv.width = Math.round(src.width * scale)
  cv.height = Math.round(src.height * scale)
  const g = cv.getContext('2d')!
  g.drawImage(src, 0, 0, cv.width, cv.height)

  // entity pins
  const tf = mapTransform()
  for (const e of world.entities) {
    if (!e.is_active || e.entity_type === 'spawn') continue
    const [x, y] = worldToMap(e.position[0], e.position[2])
    g.fillStyle = '#e8c84b'
    g.strokeStyle = 'rgba(20,20,20,0.7)'
    g.lineWidth = 1.5
    g.beginPath()
    g.arc(x * scale, y * scale, 5, 0, Math.PI * 2)
    g.fill()
    g.stroke()
  }

  // player marker
  const [px, py] = worldToMap(playerPos.value[0], playerPos.value[2])
  g.fillStyle = '#ffffff'
  g.strokeStyle = 'rgba(20,20,20,0.85)'
  g.lineWidth = 2
  g.beginPath()
  g.arc(px * scale, py * scale, 7, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.fillStyle = '#2e7d5b'
  g.beginPath()
  g.arc(px * scale, py * scale, 3.4, 0, Math.PI * 2)
  g.fill()
  g.font = 'bold 12px "Nunito", sans-serif'
  g.textAlign = 'center'
  g.strokeText('YOU', px * scale, py * scale - 11)
  g.fillText('YOU', px * scale, py * scale - 11)

  // legend inside the canvas bottom-left
  g.fillStyle = 'rgba(20,24,20,0.72)'
  const lx = 10
  const ly = cv.height - 78
  g.beginPath()
  g.roundRect(lx, ly, 190, 68, 8)
  g.fill()
  g.fillStyle = '#e8c84b'
  g.fillRect(lx + 10, ly + 10, 8, 8)
  g.fillStyle = '#fff'
  g.font = '11px "Nunito", sans-serif'
  g.textAlign = 'left'
  g.fillText('Landmarks / shops', lx + 24, ly + 18)
  g.fillStyle = '#3a4450'
  g.fillRect(lx + 10, ly + 30, 8, 8)
  g.fillText('Tall towers', lx + 24, ly + 38)
  g.fillStyle = '#d8b13c'
  g.beginPath()
  g.arc(lx + 14, ly + 54, 4.4, 0, Math.PI * 2)
  g.fill()
  g.fillText('Open houses (walk in)', lx + 24, ly + 58)
}

function onClick(e: MouseEvent) {
  const cv = canvasRef.value
  if (!cv) return
  const rect = cv.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * cv.width
  const my = ((e.clientY - rect.top) / rect.height) * cv.height
  let [wx, wz] = mapToWorld(mx, my)
  ;[wx, wz] = clampBounds(wx, wz)
  const [ux, uz] = unstick(wx, wz)
  moveTarget.value = { x: ux, z: uz }
  open.value = false
}
</script>

<template>
  <transition
    enter-active-class="transition duration-200"
    enter-from-class="opacity-0"
    leave-active-class="transition duration-150"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-ink/80 p-4 backdrop-blur-sm"
      @click.self="open = false"
    >
      <div class="flex w-full max-w-[1100px] items-center justify-between">
        <div class="text-lg font-extrabold text-white">Kaduna City Map</div>
        <button class="kk-btn-ghost !text-white" @click="open = false">✕ Close</button>
      </div>
      <div ref="wrapRef" class="max-h-[78vh] overflow-hidden rounded-3xl border-2 border-white/20 shadow-2xl">
        <canvas ref="canvasRef" class="block cursor-crosshair" @click="onClick" />
      </div>
      <div class="text-xs text-white/70">Tap anywhere on the map to walk there · north is up · gold dots are enterable homes</div>
    </div>
  </transition>
</template>
