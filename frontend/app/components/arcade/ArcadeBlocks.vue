<script setup lang="ts">
// Block Mason - stack falling blocks on a 10x18 site, clear full rows.
// Left/Right move, A rotates, Down drops faster, B slams it down.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
const COLS = 10
const ROWS = 18
const S = 18
const OX = 8
const OY = 14
let stop = () => {}

const SHAPES: number[][][] = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
  [[0, 1, 1], [1, 1, 0]]
]
const COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#16a085']

onMounted(() => {
  const g = cv.value!.getContext('2d')!
  const r = rng()
  const grid: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0))
  let piece = { s: SHAPES[0]!, c: 1, x: 3, y: 0 }
  let nextI = Math.floor(r() * 7)
  let fall = 0
  let score = 0
  let lines = 0
  let over = false
  let moveT = 0
  const fits = (s: number[][], x: number, y: number) =>
    s.every((row, j) => row.every((v, i) => !v || (x + i >= 0 && x + i < COLS && y + j < ROWS && (y + j < 0 || !grid[y + j]![x + i]))))
  const spawn = () => {
    const i = nextI
    nextI = Math.floor(r() * 7)
    piece = { s: SHAPES[i]!, c: i + 1, x: 3, y: 0 }
    if (!fits(piece.s, piece.x, piece.y)) {
      over = true
      emit('over', score)
    }
  }
  const rotate = (s: number[][]) => s[0]!.map((_, i) => s.map((row) => row[i]!).reverse())
  const lock = () => {
    piece.s.forEach((row, j) => row.forEach((v, i) => v && piece.y + j >= 0 && (grid[piece.y + j]![piece.x + i] = piece.c)))
    let cleared = 0
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y]!.every((v) => v)) {
        grid.splice(y, 1)
        grid.unshift(Array(COLS).fill(0))
        cleared++
        y++
      }
    }
    if (cleared) {
      lines += cleared
      score += [0, 100, 300, 500, 800][cleared]! * (1 + Math.floor(lines / 10))
      emit('score', score)
    }
    spawn()
  }
  spawn()
  stop = runLoop((dt) => {
    if (!over) {
      moveT -= dt
      if (took(props.pad, 'left') || (props.pad.left && moveT <= 0)) {
        if (fits(piece.s, piece.x - 1, piece.y)) piece.x--
        moveT = 0.12
      }
      if (took(props.pad, 'right') || (props.pad.right && moveT <= 0)) {
        if (fits(piece.s, piece.x + 1, piece.y)) piece.x++
        moveT = 0.12
      }
      if (took(props.pad, 'a') || took(props.pad, 'up')) {
        const rs = rotate(piece.s)
        for (const k of [0, -1, 1, -2, 2]) if (fits(rs, piece.x + k, piece.y)) { piece.s = rs; piece.x += k; break }
      }
      if (took(props.pad, 'b')) {
        while (fits(piece.s, piece.x, piece.y + 1)) piece.y++
        lock()
      }
      fall += dt * (props.pad.down ? 14 : 1.6 + lines * 0.12)
      while (fall >= 1 && !over) {
        fall -= 1
        if (fits(piece.s, piece.x, piece.y + 1)) piece.y++
        else lock()
      }
    }
    g.fillStyle = '#2b2420'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#3d342e'
    g.fillRect(OX, OY, COLS * S, ROWS * S)
    const cell = (x: number, y: number, c: number) => {
      g.fillStyle = COLORS[c - 1]!
      g.fillRect(OX + x * S + 1, OY + y * S + 1, S - 2, S - 2)
      g.fillStyle = 'rgba(255,255,255,0.25)'
      g.fillRect(OX + x * S + 1, OY + y * S + 1, S - 2, 3)
    }
    grid.forEach((row, y) => row.forEach((v, x) => v && cell(x, y, v)))
    // ghost
    let gy = piece.y
    while (fits(piece.s, piece.x, gy + 1)) gy++
    g.globalAlpha = 0.25
    piece.s.forEach((row, j) => row.forEach((v, i) => v && cell(piece.x + i, gy + j, piece.c)))
    g.globalAlpha = 1
    piece.s.forEach((row, j) => row.forEach((v, i) => v && cell(piece.x + i, piece.y + j, piece.c)))
    // side panel
    g.fillStyle = '#fff'
    g.font = 'bold 12px sans-serif'
    g.textAlign = 'left'
    const sx = OX + COLS * S + 12
    g.fillText('SCORE', sx, 30)
    g.fillText(String(score), sx, 46)
    g.fillText('ROWS', sx, 74)
    g.fillText(String(lines), sx, 90)
    g.fillText('NEXT', sx, 118)
    SHAPES[nextI]!.forEach((row, j) => row.forEach((v, i) => {
      if (!v) return
      g.fillStyle = COLORS[nextI]!
      g.fillRect(sx + i * 14, 126 + j * 14, 12, 12)
    }))
    if (over) {
      g.fillStyle = 'rgba(0,0,0,0.6)'
      g.fillRect(0, H / 2 - 30, W, 60)
      g.fillStyle = '#fff'
      g.textAlign = 'center'
      g.font = 'bold 18px sans-serif'
      g.fillText(`Site full · ${score}`, W / 2, H / 2 + 6)
    }
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" :width="W" :height="H" class="w-full rounded-xl" />
</template>
