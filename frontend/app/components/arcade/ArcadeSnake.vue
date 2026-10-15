<script setup lang="ts">
// Mango Snake - classic snake on a 18x22 grid. Mangoes grow you, a golden
// mango is worth 5. Speeds up as you grow. Swipe or arrows to turn.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'

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
  const g = cv.value!.getContext('2d')!
  const r = rng()
  let snake = [[8, 11], [7, 11], [6, 11]] as [number, number][]
  let dir: [number, number] = [1, 0]
  let next: [number, number] = [1, 0]
  let food: [number, number] = [12, 11]
  let gold = false
  let acc = 0
  let score = 0
  let dead = false
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
  stop = runLoop((dt) => {
    if (took(props.pad, 'left') && dir[0] !== 1) next = [-1, 0]
    if (took(props.pad, 'right') && dir[0] !== -1) next = [1, 0]
    if (took(props.pad, 'up') && dir[1] !== 1) next = [0, -1]
    if (took(props.pad, 'down') && dir[1] !== -1) next = [0, 1]
    if (!dead) {
      acc += dt
      const stepT = Math.max(0.06, 0.16 - snake.length * 0.003)
      while (acc > stepT) {
        acc -= stepT
        dir = next
        const h: [number, number] = [snake[0]![0] + dir[0], snake[0]![1] + dir[1]]
        if (h[0] < 0 || h[1] < 0 || h[0] >= GX || h[1] >= GY || snake.some(([x, y]) => x === h[0] && y === h[1])) {
          dead = true
          emit('over', score)
          break
        }
        snake.unshift(h)
        if (h[0] === food[0] && h[1] === food[1]) {
          score += gold ? 5 : 1
          emit('score', score)
          if (gold) snake.push(snake[snake.length - 1]!, snake[snake.length - 1]!)
          place()
        } else snake.pop()
      }
    }
    // draw: savanna checkerboard
    for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) {
      g.fillStyle = (x + y) % 2 ? '#8fbf5a' : '#86b552'
      g.fillRect(x * C, y * C, C, C)
    }
    // mango
    const [fx, fy] = food
    g.fillStyle = gold ? '#ffd700' : '#f39c12'
    g.beginPath()
    g.ellipse(fx * C + 8, fy * C + 9, 6, 7, 0.4, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#2e7d32'
    g.fillRect(fx * C + 8, fy * C + 1, 4, 3)
    // snake
    snake.forEach(([x, y], i) => {
      g.fillStyle = i === 0 ? '#1b5e20' : i % 2 ? '#2e7d32' : '#388e3c'
      g.fillRect(x * C + 1, y * C + 1, C - 2, C - 2)
    })
    const [hx, hy] = snake[0]!
    g.fillStyle = '#fff'
    g.fillRect(hx * C + 4 + dir[0] * 3, hy * C + 4 + dir[1] * 3, 3, 3)
    g.fillRect(hx * C + 9 + dir[0] * 3, hy * C + 4 + dir[1] * 3, 3, 3)
    if (dead) {
      g.fillStyle = 'rgba(0,0,0,0.55)'
      g.fillRect(0, H / 2 - 30, W, 60)
      g.fillStyle = '#fff'
      g.font = 'bold 20px sans-serif'
      g.textAlign = 'center'
      g.fillText(`Game over · ${score}`, W / 2, H / 2 + 7)
    }
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" :width="W" :height="H" class="w-full rounded-xl [image-rendering:pixelated]" />
</template>
