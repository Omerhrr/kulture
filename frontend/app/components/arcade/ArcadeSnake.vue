<script setup lang="ts">
// Mango Snake - classic snake on a 18x22 grid. Mangoes grow you, a golden
// mango is worth 5. Speeds up as you grow. Swipe or arrows to turn.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'
import { hidpi, fillTex, drawMango, hudPill, hudText, banner, vignette, Particles } from '~/utils/arcadeArt'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
const C = 16
const GX = W / C
const GY = H / C
let stop = () => {}

onMounted(() => {
  const g = hidpi(cv.value!, W, H)
  const r = rng()
  let snake = [[8, 11], [7, 11], [6, 11]] as [number, number][]
  let dir: [number, number] = [1, 0]
  let next: [number, number] = [1, 0]
  let food: [number, number] = [12, 11]
  let gold = false
  let acc = 0
  let stepT = 0.16
  let grew = false
  let score = 0
  let dead = false
  const fx = new Particles()
  // a few stones and flowers in the grass (fixed for this run)
  const decor = Array.from({ length: 22 }, () => ({ x: r() * W, y: r() * H, k: r() }))
  const place = () => {
    do food = [Math.floor(r() * GX), Math.floor(r() * GY)]
    while (snake.some(([x, y]) => x === food[0] && y === food[1]))
    gold = r() < 0.15
  }
  // swipe
  let sx = 0
  let sy = 0
  cv.value!.addEventListener('touchstart', (e) => ((sx = e.touches[0]!.clientX), (sy = e.touches[0]!.clientY)), { passive: true })
  cv.value!.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0]!.clientX - sx
    const dy = e.changedTouches[0]!.clientY - sy
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return
    props.pad.pressed.add(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  })
  stop = runLoop((dt, t) => {
    if (took(props.pad, 'left') && dir[0] !== 1) next = [-1, 0]
    if (took(props.pad, 'right') && dir[0] !== -1) next = [1, 0]
    if (took(props.pad, 'up') && dir[1] !== 1) next = [0, -1]
    if (took(props.pad, 'down') && dir[1] !== -1) next = [0, 1]
    if (!dead) {
      acc += dt
      stepT = Math.max(0.06, 0.16 - snake.length * 0.003)
      while (acc > stepT) {
        acc -= stepT
        dir = next
        const h: [number, number] = [snake[0]![0] + dir[0], snake[0]![1] + dir[1]]
        if (h[0] < 0 || h[1] < 0 || h[0] >= GX || h[1] >= GY || snake.some(([x, y]) => x === h[0] && y === h[1])) {
          dead = true
          fx.burst(snake[0]![0] * C + 8, snake[0]![1] * C + 8, 18, ['#2e7d32', '#a5d66b', '#ffffff'], 120, 0.6, 2.2, 0)
          emit('over', score)
          break
        }
        snake.unshift(h)
        grew = false
        if (h[0] === food[0] && h[1] === food[1]) {
          score += gold ? 5 : 1
          emit('score', score)
          fx.burst(food[0] * C + 8, food[1] * C + 8, gold ? 18 : 10, gold ? ['#ffd700', '#fff3b0'] : ['#f5a623', '#ffe680', '#7da33a'], 90, 0.45, 2, 0)
          if (gold) snake.push(snake[snake.length - 1]!, snake[snake.length - 1]!)
          grew = true
          place()
        } else snake.pop()
      }
    }
    fx.update(dt)

    // ---- the field: grass, a mown checker, stones and flowers
    fillTex(g, 'grass', 0, 0, W, H)
    g.fillStyle = 'rgba(255,255,255,0.05)'
    for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) if ((x + y) % 2) g.fillRect(x * C, y * C, C, C)
    for (const d of decor) {
      if (d.k < 0.5) {
        g.fillStyle = 'rgba(0,0,0,0.2)'
        g.beginPath()
        g.ellipse(d.x + 1, d.y + 1.5, 3.2, 2.2, 0, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#a9a39a'
        g.beginPath()
        g.ellipse(d.x, d.y, 3, 2, 0.3, 0, Math.PI * 2)
        g.fill()
      } else {
        g.fillStyle = d.k < 0.75 ? '#f7f3e3' : '#f2c14e'
        for (let i = 0; i < 5; i++) {
          g.beginPath()
          g.arc(d.x + Math.cos(i * 1.26) * 1.8, d.y + Math.sin(i * 1.26) * 1.8, 1.2, 0, Math.PI * 2)
          g.fill()
        }
      }
    }

    // ---- mango
    drawMango(g, food[0] * C + 8, food[1] * C + 8 + Math.sin(t * 4) * 0.8, 7.4, t, gold)

    // ---- snake: a smooth body through the cell centres, the head and tail
    // gliding between steps so it moves continuously
    const f = dead ? 0 : Math.min(1, acc / stepT)
    const pts: Array<[number, number]> = snake.map(([x, y]) => [x * C + 8, y * C + 8])
    const head = pts[0]!
    const ahead: [number, number] = [head[0] + next[0] * C * f, head[1] + next[1] * C * f]
    if (!grew && pts.length > 1) {
      const a = pts[pts.length - 1]!
      const b = pts[pts.length - 2]!
      pts[pts.length - 1] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    }
    pts.unshift(ahead)
    const path = () => {
      g.beginPath()
      g.moveTo(pts[0]![0], pts[0]![1])
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1])
    }
    g.lineCap = 'round'
    g.lineJoin = 'round'
    // shadow
    g.save()
    g.translate(2, 3)
    path()
    g.strokeStyle = 'rgba(0,0,0,0.25)'
    g.lineWidth = 13
    g.stroke()
    g.restore()
    // outline, body, belly highlight
    path()
    g.strokeStyle = '#123d17'
    g.lineWidth = 13.5
    g.stroke()
    g.strokeStyle = '#2f8a3a'
    g.lineWidth = 11
    g.stroke()
    g.strokeStyle = '#5cb85c'
    g.lineWidth = 5
    g.stroke()
    g.strokeStyle = 'rgba(220,255,180,0.35)'
    g.lineWidth = 1.6
    g.save()
    g.translate(-1.2, -1.6)
    path()
    g.stroke()
    g.restore()
    // diamond markings along the back
    g.fillStyle = 'rgba(16,60,20,0.65)'
    for (let i = 2; i < pts.length - 1; i++) {
      const [x, y] = pts[i]!
      g.save()
      g.translate(x, y)
      g.rotate(Math.PI / 4)
      g.fillRect(-1.8, -1.8, 3.6, 3.6)
      g.restore()
    }
    // head
    const [hx, hy] = ahead
    const ang = Math.atan2(next[1], next[0])
    g.save()
    g.translate(hx, hy)
    g.rotate(ang)
    if (!dead && Math.sin(t * 7) > 0.3) {
      g.strokeStyle = '#d6303a'
      g.lineWidth = 1.2
      g.beginPath()
      g.moveTo(8, 0)
      g.lineTo(13, 0)
      g.lineTo(15, -1.8)
      g.moveTo(13, 0)
      g.lineTo(15, 1.8)
      g.stroke()
    }
    const hg = g.createRadialGradient(1, -2, 1, 0, 0, 9)
    hg.addColorStop(0, '#6fcf6f')
    hg.addColorStop(1, '#1f6b28')
    g.fillStyle = hg
    g.strokeStyle = '#123d17'
    g.lineWidth = 1.2
    g.beginPath()
    g.ellipse(1.5, 0, 8.5, 7, 0, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    for (const s of [-1, 1]) {
      g.fillStyle = '#fff8d0'
      g.beginPath()
      g.ellipse(3.5, s * 3.6, 2.4, 2, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#111'
      g.beginPath()
      g.ellipse(4.3, s * 3.6, 0.9, 1.6, 0, 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
    fx.draw(g)
    vignette(g, W, H, 0.3)

    // ---- HUD
    hudPill(g, 6, 6, 92, 24)
    g.save()
    g.translate(22, 18)
    g.scale(0.7, 0.7)
    drawMango(g, 0, 0, 7, t)
    g.restore()
    hudText(g, String(score), 60, 23, 'center', 14)
    hudPill(g, W - 86, 6, 80, 24)
    hudText(g, `${snake.length} long`, W - 46, 22, 'center', 11, '#c8f7c5')
    if (dead) banner(g, W, H, `Game over · ${score}`, `${snake.length} segments long`)
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" class="aspect-[288/352] w-full rounded-xl" />
</template>
