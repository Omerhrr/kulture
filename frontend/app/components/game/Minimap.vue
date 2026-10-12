<script setup lang="ts">
// Minimap - circular crop of the prerendered city map that follows the
// player, with entity pins and a rotating player arrow. North is up.
import { getMapCanvas, mapTransform, worldToMap } from '~/utils/kadunaMap'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const playerFacing = useState<number>('kk_player_facing', () => 0)
const world = useWorldStore()
const ride = useRide()

const isTouch = useIsTouch()
const SIZE = isTouch.value ? 116 : 168
const canvasRef = ref<HTMLCanvasElement | null>(null)
let raf = 0
let last = 0

onMounted(() => {
  const draw = (t: number) => {
    raf = requestAnimationFrame(draw)
    if (t - last < 120) return
    last = t
    const cv = canvasRef.value
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const src = getMapCanvas(false)
    const tf = mapTransform()
    // show ~420 m across
    const spanUnits = 420
    const srcSpan = (spanUnits * tf.pxPerUnit * src.width) / tf.pxW
    const [cx, cy] = worldToMap(playerPos.value[0], playerPos.value[2])
    const scale = cv.width / srcSpan
    g.clearRect(0, 0, cv.width, cv.height)
    g.save()
    g.beginPath()
    g.arc(cv.width / 2, cv.height / 2, cv.width / 2, 0, Math.PI * 2)
    g.clip()
    g.fillStyle = '#87a55f'
    g.fillRect(0, 0, cv.width, cv.height)
    g.drawImage(
      src,
      cx - srcSpan / 2,
      cy - srcSpan / 2,
      srcSpan,
      srcSpan,
      0,
      0,
      cv.width,
      cv.height
    )

    // entity pins
    for (const e of world.entities) {
      if (!e.is_active || e.entity_type === 'spawn') continue
      const [ex, ey] = worldToMap(e.position[0], e.position[2])
      const px = (ex - (cx - srcSpan / 2)) * scale
      const py = (ey - (cy - srcSpan / 2)) * scale
      if (px < 4 || py < 4 || px > cv.width - 4 || py > cv.height - 4) continue
      g.fillStyle = '#e8c84b'
      g.strokeStyle = 'rgba(30,30,30,0.6)'
      g.lineWidth = 1
      g.beginPath()
      g.arc(px, py, 3.4, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }

    // player arrow (facing 0 = +Z = south = down)
    const f = playerFacing.value
    g.save()
    g.translate(cv.width / 2, cv.height / 2)
    g.rotate(Math.atan2(Math.cos(f), Math.sin(f)))
    g.fillStyle = ride.value.active ? '#3f6fae' : '#ffffff'
    g.strokeStyle = 'rgba(20,20,20,0.7)'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(9, 0)
    g.lineTo(-6, -6)
    g.lineTo(-3, 0)
    g.lineTo(-6, 6)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
    g.restore()

    // compass
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.strokeStyle = 'rgba(20,20,20,0.5)'
    g.lineWidth = 2.5
    g.font = 'bold 11px "Nunito", sans-serif'
    g.textAlign = 'center'
    g.strokeText('N', cv.width / 2, 14)
    g.fillText('N', cv.width / 2, 14)
  }
  raf = requestAnimationFrame(draw)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div
    class="pointer-events-none fixed rounded-full border-[3px] border-white/70 shadow-xl shadow-ink/25"
    :class="isTouch ? 'right-3 top-24' : 'bottom-4 right-4 sm:bottom-6 sm:right-6'"
    :style="{ width: SIZE + 'px', height: SIZE + 'px' }"
  >
    <canvas ref="canvasRef" :width="SIZE" :height="SIZE" class="h-full w-full rounded-full" />
    <div
      v-if="ride.active"
      class="absolute inset-x-0 -bottom-1 mx-auto w-fit rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-bold text-white"
    >
      {{ ride.name }} {{ ride.speed }} km/h
    </div>
  </div>
</template>
