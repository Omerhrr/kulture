<script setup lang="ts">
// Okada Dash - endless top-down ride up a 3-lane Kaduna road. Swerve
// between danfos, kekes and potholes, grab fuel cans. Gets faster.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
let stop = () => {}

onMounted(() => {
  const g = cv.value!.getContext('2d')!
  const r = rng()
  const LANES = [84, 144, 204]
  let lane = 1
  let px = LANES[1]!
  let speed = 160
  let dist = 0
  let scroll = 0
  let fuel = 100
  let dead = false
  let spawn = 0
  const things: Array<{ x: number; y: number; kind: 'danfo' | 'keke' | 'hole' | 'fuel'; vy: number }> = []
  // swipe left/right
  let sx = 0
  cv.value!.addEventListener('touchstart', (e) => (sx = e.touches[0]!.clientX), { passive: true })
  cv.value!.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0]!.clientX - sx
    if (Math.abs(dx) > 20) props.pad.pressed.add(dx > 0 ? 'right' : 'left')
  })
  stop = runLoop((dt) => {
    if (!dead) {
      if (took(props.pad, 'left')) lane = Math.max(0, lane - 1)
      if (took(props.pad, 'right')) lane = Math.min(2, lane + 1)
      px += (LANES[lane]! - px) * Math.min(1, dt * 14)
      speed += dt * 6
      dist += speed * dt
      scroll = (scroll + speed * dt) % 40
      fuel -= dt * 4
      spawn -= dt
      if (spawn <= 0) {
        spawn = Math.max(0.35, 1.1 - speed / 600) * (0.6 + r())
        const k = r()
        things.push({ x: LANES[Math.floor(r() * 3)]!, y: -60, kind: k < 0.35 ? 'danfo' : k < 0.7 ? 'keke' : k < 0.88 ? 'hole' : 'fuel', vy: k < 0.7 ? -40 - r() * 30 : 0 })
      }
      for (const t of things) t.y += (speed + t.vy) * dt
      for (let i = things.length - 1; i >= 0; i--) {
        const t = things[i]!
        const h = t.kind === 'danfo' ? 56 : t.kind === 'keke' ? 34 : 18
        if (Math.abs(t.x - px) < 22 && t.y + h / 2 > 268 && t.y - h / 2 < 310) {
          if (t.kind === 'fuel') {
            fuel = Math.min(100, fuel + 35)
            things.splice(i, 1)
            continue
          }
          dead = true
        }
        if (t.y > H + 80) things.splice(i, 1)
      }
      if (fuel <= 0) dead = true
      const score = Math.floor(dist / 10)
      if (Math.floor(dist / 10) % 25 === 0) emit('score', score)
      if (dead) emit('over', score)
    }
    // ---- draw road
    g.fillStyle = '#c9b48f'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#4a4a50'
    g.fillRect(54, 0, 180, H)
    g.fillStyle = '#e0c040'
    for (let y = -40 + scroll; y < H; y += 40) {
      g.fillRect(112, y, 4, 22)
      g.fillRect(172, y, 4, 22)
    }
    g.fillStyle = '#6aa84f'
    for (let y = -40 + scroll; y < H; y += 80) g.fillRect(18, y, 22, 22), g.fillRect(250, y + 40, 22, 22)
    for (const t of things) {
      if (t.kind === 'danfo') {
        g.fillStyle = '#f5c400'
        g.fillRect(t.x - 18, t.y - 28, 36, 56)
        g.fillStyle = '#111'
        g.fillRect(t.x - 18, t.y - 6, 36, 3)
        g.fillRect(t.x - 18, t.y + 4, 36, 3)
        g.fillStyle = '#7fb6d6'
        g.fillRect(t.x - 14, t.y + 18, 28, 7)
      } else if (t.kind === 'keke') {
        g.fillStyle = '#2e8b57'
        g.fillRect(t.x - 13, t.y - 17, 26, 34)
        g.fillStyle = '#f5c400'
        g.fillRect(t.x - 13, t.y - 17, 26, 8)
      } else if (t.kind === 'hole') {
        g.fillStyle = '#2b2b2f'
        g.beginPath()
        g.ellipse(t.x, t.y, 16, 9, 0, 0, Math.PI * 2)
        g.fill()
      } else {
        g.fillStyle = '#d63031'
        g.fillRect(t.x - 8, t.y - 10, 16, 20)
        g.fillStyle = '#fff'
        g.font = 'bold 9px sans-serif'
        g.textAlign = 'center'
        g.fillText('⛽', t.x, t.y + 4)
      }
    }
    // the okada + rider
    g.fillStyle = '#222'
    g.fillRect(px - 4, 270, 8, 40)
    g.fillStyle = '#c0392b'
    g.fillRect(px - 7, 282, 14, 16)
    g.fillStyle = '#6e4630'
    g.beginPath()
    g.arc(px, 284, 6, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#f39c12'
    g.fillRect(px - 6, 278, 12, 4)
    // HUD
    g.fillStyle = 'rgba(0,0,0,0.4)'
    g.fillRect(0, 0, W, 24)
    g.fillStyle = '#fff'
    g.font = 'bold 13px sans-serif'
    g.textAlign = 'left'
    g.fillText(`${Math.floor(dist / 10)} m`, 8, 17)
    g.textAlign = 'right'
    g.fillText('⛽', W - 92, 17)
    g.fillStyle = fuel > 25 ? '#2ecc71' : '#e74c3c'
    g.fillRect(W - 86, 8, (78 * Math.max(0, fuel)) / 100, 9)
    if (dead) {
      g.fillStyle = 'rgba(0,0,0,0.55)'
      g.fillRect(0, H / 2 - 30, W, 60)
      g.fillStyle = '#fff'
      g.textAlign = 'center'
      g.font = 'bold 18px sans-serif'
      g.fillText(fuel <= 0 ? `Out of fuel · ${Math.floor(dist / 10)} m` : `Crash! · ${Math.floor(dist / 10)} m`, W / 2, H / 2 + 6)
    }
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" :width="W" :height="H" class="w-full rounded-xl" />
</template>
