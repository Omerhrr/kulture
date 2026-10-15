<script setup lang="ts">
// Mallam Run - a side-scrolling platformer (original): run through a
// Kaduna street level, jump gutters, hop on brick ledges, stomp wandering
// goats, collect coins and reach the green-white-green flag. 3 lives.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
let stop = () => {}

interface Box { x: number; y: number; w: number; h: number }
interface Goat { x: number; y: number; vx: number; alive: boolean }

onMounted(() => {
  const g = cv.value!.getContext('2d')!
  const r = rng(4242)
  const GROUND = 300
  const END = 3400
  // ---- level
  const solids: Box[] = []
  const coins: Array<{ x: number; y: number; got: boolean }> = []
  const goats: Goat[] = []
  let x = 0
  while (x < END + 300) {
    const len = 260 + Math.floor(r() * 300)
    solids.push({ x, y: GROUND, w: len, h: 60 })
    if (x > 200) {
      // ledges + coins over this stretch
      const lx = x + 60 + r() * (len - 160)
      const ly = GROUND - 70 - r() * 50
      solids.push({ x: lx, y: ly, w: 70, h: 16 })
      for (let i = 0; i < 3; i++) coins.push({ x: lx + 12 + i * 22, y: ly - 22, got: false })
      if (r() < 0.75) goats.push({ x: x + 40 + r() * (len - 80), y: GROUND - 22, vx: -40, alive: true })
    }
    for (let i = 0; i < 2; i++) coins.push({ x: x + 40 + r() * (len - 80), y: GROUND - 40, got: false })
    x += len + (x > 100 && x < END ? 46 + Math.floor(r() * 40) : 0) // gutter gap
  }
  // ---- player
  const p = { x: 40, y: GROUND - 30, vx: 0, vy: 0, w: 18, h: 30, ground: false, face: 1 }
  let cam = 0
  let lives = 3
  let score = 0
  let state: 'play' | 'dead' | 'win' | 'over' = 'play'
  let deadT = 0
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  const respawn = () => {
    p.x = Math.max(40, cam + 40)
    // drop back onto the nearest ground
    const s = solids.find((s) => s.y === GROUND && p.x >= s.x && p.x <= s.x + s.w) ?? solids[0]!
    p.x = Math.max(p.x, s.x + 10)
    p.y = GROUND - 60
    p.vx = p.vy = 0
    state = 'play'
  }
  const die = () => {
    lives--
    state = lives > 0 ? 'dead' : 'over'
    deadT = 1.2
    if (state === 'over') emit('over', score)
  }

  stop = runLoop((dt) => {
    if (state === 'play') {
      const accel = 900
      if (props.pad.left) (p.vx -= accel * dt), (p.face = -1)
      if (props.pad.right) (p.vx += accel * dt), (p.face = 1)
      p.vx *= p.ground ? 0.86 : 0.97
      p.vx = Math.max(-170, Math.min(170, p.vx))
      if ((took(props.pad, 'a') || took(props.pad, 'up')) && p.ground) p.vy = -430
      if (!props.pad.a && !props.pad.up && p.vy < -160) p.vy += 1200 * dt // short hop
      p.vy += 1300 * dt
      // move + collide (x then y)
      p.x += p.vx * dt
      for (const s of solids) if (hit(p, s)) p.x = p.vx > 0 ? s.x - p.w : s.x + s.w
      p.y += p.vy * dt
      p.ground = false
      for (const s of solids) {
        if (!hit(p, s)) continue
        if (p.vy > 0) (p.y = s.y - p.h), (p.vy = 0), (p.ground = true)
        else (p.y = s.y + s.h), (p.vy = 0)
      }
      p.x = Math.max(cam, p.x)
      if (p.y > H) die()
      // coins
      for (const c of coins) if (!c.got && Math.abs(c.x - (p.x + 9)) < 14 && Math.abs(c.y - (p.y + 15)) < 18) (c.got = true), (score += 10), emit('score', score)
      // goats: walk, turn at edges, stomp or get butted
      for (const gt of goats) {
        if (!gt.alive || Math.abs(gt.x - p.x) > 400) continue
        gt.x += gt.vx * dt
        const onGround = solids.some((s) => s.y === GROUND && gt.x + 12 > s.x && gt.x + 12 < s.x + s.w)
        if (!onGround) (gt.vx *= -1), (gt.x += gt.vx * dt * 2)
        const gb = { x: gt.x, y: gt.y, w: 24, h: 22 }
        if (hit(p, gb)) {
          if (p.vy > 50 && p.y + p.h - gt.y < 14) (gt.alive = false), (p.vy = -300), (score += 50), emit('score', score)
          else die()
        }
      }
      if (p.x > END) {
        state = 'win'
        score += 500 + lives * 100
        emit('score', score)
        emit('over', score)
      }
      cam += (p.x - 110 - cam) * Math.min(1, dt * 6)
      cam = Math.max(0, cam)
    } else if (state === 'dead') {
      deadT -= dt
      if (deadT <= 0) respawn()
    }

    // ---- draw
    const sky = g.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#7ec8f0')
    sky.addColorStop(1, '#f6d9a8')
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    // distant buildings (parallax)
    for (let i = 0; i < 30; i++) {
      const bx = i * 120 - (cam * 0.3) % 120 - 120
      g.fillStyle = i % 2 ? '#d9c7a6' : '#c9b48f'
      g.fillRect(bx, 170 + (i % 3) * 20, 90, 200)
      g.fillStyle = '#8a7a5c'
      for (let wy = 0; wy < 3; wy++) g.fillRect(bx + 14, 190 + (i % 3) * 20 + wy * 30, 12, 14), g.fillRect(bx + 50, 190 + (i % 3) * 20 + wy * 30, 12, 14)
    }
    g.save()
    g.translate(-Math.round(cam), 0)
    for (const s of solids) {
      g.fillStyle = s.y === GROUND ? '#9c6b3e' : '#b5523b'
      g.fillRect(s.x, s.y, s.w, s.h)
      g.fillStyle = s.y === GROUND ? '#6aa84f' : '#8d3b28'
      g.fillRect(s.x, s.y, s.w, s.y === GROUND ? 6 : 3)
      if (s.y !== GROUND) for (let bx = s.x; bx < s.x + s.w; bx += 14) g.fillRect(bx, s.y, 1, s.h)
    }
    for (const c of coins) {
      if (c.got) continue
      g.fillStyle = '#ffcc00'
      g.beginPath()
      g.arc(c.x, c.y, 6, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#b8860b'
      g.fillRect(c.x - 1, c.y - 3, 2, 6)
    }
    for (const gt of goats) {
      if (!gt.alive) continue
      g.fillStyle = '#e8e2d0'
      g.fillRect(gt.x, gt.y + 4, 22, 12)
      g.fillRect(gt.vx < 0 ? gt.x - 6 : gt.x + 20, gt.y, 8, 9)
      g.fillStyle = '#5a4a3a'
      g.fillRect(gt.x + 2, gt.y + 16, 3, 6)
      g.fillRect(gt.x + 16, gt.y + 16, 3, 6)
      g.fillRect(gt.vx < 0 ? gt.x - 5 : gt.x + 24, gt.y - 3, 2, 4)
    }
    // flag
    g.fillStyle = '#ddd'
    g.fillRect(END, GROUND - 120, 4, 120)
    g.fillStyle = '#008751'
    g.fillRect(END + 4, GROUND - 118, 12, 26)
    g.fillStyle = '#fff'
    g.fillRect(END + 16, GROUND - 118, 12, 26)
    g.fillStyle = '#008751'
    g.fillRect(END + 28, GROUND - 118, 12, 26)
    // mallam: kaftan + cap
    if (state !== 'dead' || Math.floor(deadT * 10) % 2) {
      g.fillStyle = '#efe8d6'
      g.fillRect(p.x, p.y + 8, p.w, 18)
      g.fillStyle = '#6e4630'
      g.fillRect(p.x + 3, p.y, 12, 10)
      g.fillStyle = '#2e7d5b'
      g.fillRect(p.x + 3, p.y - 3, 12, 4)
      g.fillStyle = '#2b3440'
      const step = p.ground && Math.abs(p.vx) > 20 ? Math.sin(performance.now() / 70) * 3 : 0
      g.fillRect(p.x + 3 + step, p.y + 26, 5, 4)
      g.fillRect(p.x + 10 - step, p.y + 26, 5, 4)
      g.fillStyle = '#000'
      g.fillRect(p.face > 0 ? p.x + 11 : p.x + 5, p.y + 3, 2, 2)
    }
    g.restore()
    // HUD
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.fillRect(0, 0, W, 22)
    g.fillStyle = '#fff'
    g.font = 'bold 13px sans-serif'
    g.textAlign = 'left'
    g.fillText(`🪙 ${score}`, 8, 16)
    g.textAlign = 'right'
    g.fillText('❤'.repeat(Math.max(0, lives)), W - 8, 16)
    g.textAlign = 'center'
    g.fillText(`${Math.max(0, Math.round((END - p.x) / 10))} m`, W / 2, 16)
    if (state === 'win' || state === 'over') {
      g.fillStyle = 'rgba(0,0,0,0.55)'
      g.fillRect(0, H / 2 - 30, W, 60)
      g.fillStyle = '#fff'
      g.font = 'bold 18px sans-serif'
      g.fillText(state === 'win' ? `You made it! ${score}` : `Game over · ${score}`, W / 2, H / 2 + 6)
    }
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" :width="W" :height="H" class="w-full rounded-xl" />
</template>
