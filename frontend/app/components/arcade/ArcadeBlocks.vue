<script setup lang="ts">
// Block Mason - stack falling blocks on a 10x18 site, clear full rows.
// Left/Right move, A rotates, Down drops faster, B slams it down.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'
import { hidpi, fillTex, pattern, shade, rrect, hudText, banner, vignette, Particles } from '~/utils/arcadeArt'

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
// fired brick, laterite, sandcrete, painted blocks: the colours of a Kaduna site
const COLORS = ['#b5523b', '#d9822b', '#d8b23a', '#5f9a4a', '#3d78b0', '#8a5aa8', '#3a9a8a']

/** sand, the foundation pit and its scaffolding, painted once */
function paintSite(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  const g = hidpi(cv, W, H)
  fillTex(g, 'sand', 0, 0, W, H)
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, 'rgba(255,240,210,0.25)')
  sky.addColorStop(1, 'rgba(120,80,40,0.25)')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  // the pit: dark earth with a soft inner shadow
  const pw = COLS * S
  const ph = ROWS * S
  fillTex(g, 'laterite', OX, OY, pw, ph)
  g.fillStyle = 'rgba(30,18,10,0.55)'
  g.fillRect(OX, OY, pw, ph)
  const ig = g.createLinearGradient(0, OY, 0, OY + 30)
  ig.addColorStop(0, 'rgba(0,0,0,0.45)')
  ig.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = ig
  g.fillRect(OX, OY, pw, 30)
  // faint string lines the mason sets out
  g.strokeStyle = 'rgba(255,255,255,0.06)'
  g.lineWidth = 1
  for (let x = 1; x < COLS; x++) (g.beginPath(), g.moveTo(OX + x * S, OY), g.lineTo(OX + x * S, OY + ph), g.stroke())
  // scaffolding: steel poles + wooden boards around the pit
  const pole = (x: number) => {
    const pg = g.createLinearGradient(x - 2, 0, x + 2, 0)
    pg.addColorStop(0, '#5a5f66')
    pg.addColorStop(0.5, '#c9ccd1')
    pg.addColorStop(1, '#5a5f66')
    g.fillStyle = pg
    g.fillRect(x - 2, 4, 4, H - 8)
  }
  pole(OX - 4)
  pole(OX + pw + 4)
  for (let y = OY + 40; y < OY + ph; y += 80) {
    g.fillStyle = '#8a8f99'
    g.fillRect(OX - 6, y, pw + 12, 2)
  }
  const board = (y: number) => {
    const bg = g.createLinearGradient(0, y, 0, y + 6)
    bg.addColorStop(0, '#c49a62')
    bg.addColorStop(1, '#7a5230')
    g.fillStyle = bg
    g.fillRect(OX - 7, y, pw + 14, 6)
  }
  board(OY - 7)
  board(OY + ph + 1)
  // cement bags + a wheelbarrow corner on the right
  for (let i = 0; i < 3; i++) {
    const bx = OX + pw + 14 + i * 13
    const by = H - 32 + (i % 2) * 4
    g.fillStyle = 'rgba(0,0,0,0.2)'
    g.fillRect(bx + 2, by + 3, 22, 14)
    g.fillStyle = '#e8e2d0'
    rrect(g, bx, by, 22, 14, 3)
    g.fill()
    g.fillStyle = '#c0392b'
    g.fillRect(bx + 4, by + 5, 14, 3)
  }
  return cv
}

onMounted(() => {
  const g = hidpi(cv.value!, W, H)
  const siteBg = paintSite()
  const blockTex = pattern(g, 'concrete', 32)
  const flashes: Array<{ y: number; t: number }> = []
  const dust = new Particles()
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
        flashes.push({ y, t: 0.3 })
        for (let k = 0; k < 6; k++) dust.burst(OX + (k * 2 + 1) * S, OY + y * S + S / 2, 3, ['#d8c39a', '#b9b4aa', '#f2f0ea'], 80, 0.6, 2, 160)
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
    // ---- draw: the site, the pit, scaffolding, blocks
    g.drawImage(siteBg, 0, 0, W, H)
    const cell = (x: number, y: number, c: number, a = 1) => {
      const px = OX + x * S
      const py = OY + y * S
      const col = COLORS[c - 1]!
      g.globalAlpha = a
      const bg = g.createLinearGradient(px, py, px + S, py + S)
      bg.addColorStop(0, shade(col, 0.22))
      bg.addColorStop(1, shade(col, -0.18))
      g.fillStyle = bg
      g.fillRect(px + 0.5, py + 0.5, S - 1, S - 1)
      g.globalAlpha = a * 0.35
      g.fillStyle = blockTex
      g.fillRect(px + 0.5, py + 0.5, S - 1, S - 1)
      g.globalAlpha = a
      // bevel + mortar line + the block's two hollows
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillRect(px + 1, py + 1, S - 2, 2)
      g.fillRect(px + 1, py + 1, 2, S - 2)
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.fillRect(px + 1, py + S - 3, S - 2, 2)
      g.fillRect(px + S - 3, py + 1, 2, S - 2)
      g.fillStyle = 'rgba(0,0,0,0.18)'
      g.fillRect(px + 4, py + 5, 4, 7)
      g.fillRect(px + 10, py + 5, 4, 7)
      g.globalAlpha = 1
    }
    grid.forEach((row, y) => row.forEach((v, x) => v && cell(x, y, v)))
    // ghost: a chalk outline where it will land
    let gy = piece.y
    while (fits(piece.s, piece.x, gy + 1)) gy++
    g.strokeStyle = 'rgba(255,255,255,0.55)'
    g.setLineDash([3, 2])
    g.lineWidth = 1
    piece.s.forEach((row, j) => row.forEach((v, i) => v && g.strokeRect(OX + (piece.x + i) * S + 1.5, OY + (gy + j) * S + 1.5, S - 3, S - 3)))
    g.setLineDash([])
    // falling piece with a drop shadow
    g.fillStyle = 'rgba(0,0,0,0.25)'
    piece.s.forEach((row, j) => row.forEach((v, i) => v && g.fillRect(OX + (piece.x + i) * S + 3, OY + (piece.y + j) * S + 3, S - 1, S - 1)))
    piece.s.forEach((row, j) => row.forEach((v, i) => v && cell(piece.x + i, piece.y + j, piece.c)))
    // cleared rows flash, dust flies
    for (const f of flashes) {
      f.t -= dt
      g.fillStyle = `rgba(255,250,230,${Math.max(0, f.t / 0.3) * 0.8})`
      g.fillRect(OX, OY + f.y * S, COLS * S, S)
    }
    for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i]!.t <= 0) flashes.splice(i, 1)
    dust.update(dt)
    dust.draw(g)
    // site board: score, rows, next block
    const sx = OX + COLS * S + 10
    const bw = W - sx - 6
    const panel = (y: number, h: number, label: string, value?: string) => {
      g.fillStyle = 'rgba(20,24,30,0.78)'
      rrect(g, sx, y, bw, h, 8)
      g.fill()
      g.strokeStyle = 'rgba(245,196,0,0.6)'
      g.lineWidth = 1
      g.stroke()
      hudText(g, label, sx + bw / 2, y + 13, 'center', 9, '#f5c400')
      if (value) hudText(g, value, sx + bw / 2, y + 31, 'center', 15)
    }
    panel(14, 40, 'SCORE', String(score))
    panel(60, 40, 'ROWS', String(lines))
    panel(106, 40, 'LEVEL', String(1 + Math.floor(lines / 10)))
    panel(152, 66, 'NEXT')
    const nx = SHAPES[nextI]!
    const ns = 12
    const ox = sx + (bw - nx[0]!.length * ns) / 2
    nx.forEach((row, j) => row.forEach((v, i) => {
      if (!v) return
      const col = COLORS[nextI]!
      const bg2 = g.createLinearGradient(0, 172 + j * ns, 0, 172 + (j + 1) * ns)
      bg2.addColorStop(0, shade(col, 0.2))
      bg2.addColorStop(1, shade(col, -0.2))
      g.fillStyle = bg2
      g.fillRect(ox + i * ns, 178 + j * ns, ns - 1, ns - 1)
    }))
    vignette(g, W, H, 0.25)
    if (over) banner(g, W, H, `Site full · ${score}`, `${lines} rows laid`)
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" class="aspect-[288/352] w-full rounded-xl" />
</template>
