<script setup lang="ts">
// Mallam Run - a side-scrolling platformer (original): run through a
// Kaduna street level, jump gutters, hop on brick ledges, stomp wandering
// goats, collect coins and reach the green-white-green flag. 3 lives.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'
import { hidpi, fillTex, drawCoin, drawPerson, POSE, lookFromSim, groundShadow, hudPill, hudText, banner, vignette, shade, Particles } from '~/utils/arcadeArt'
import { useSimStore } from '~/stores/sim'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
let stop = () => {}

interface Box { x: number; y: number; w: number; h: number }
interface Goat { x: number; y: number; vx: number; alive: boolean }

/** sky, a far skyline and a row of houses, painted once as tiling strips */
function paintBackdrop() {
  const mk = (w: number, h: number) => {
    const c = document.createElement('canvas')
    c.width = w * 2
    c.height = h * 2
    const g = c.getContext('2d')!
    g.scale(2, 2)
    return { c, g }
  }
  const sky = mk(W, H)
  const sg = sky.g.createLinearGradient(0, 0, 0, H)
  sg.addColorStop(0, '#5fb3e8')
  sg.addColorStop(0.6, '#bfe0ef')
  sg.addColorStop(1, '#f6d9a8')
  sky.g.fillStyle = sg
  sky.g.fillRect(0, 0, W, H)
  const sun = sky.g.createRadialGradient(220, 70, 4, 220, 70, 70)
  sun.addColorStop(0, 'rgba(255,250,220,1)')
  sun.addColorStop(0.2, 'rgba(255,240,180,0.6)')
  sun.addColorStop(1, 'rgba(255,240,180,0)')
  sky.g.fillStyle = sun
  sky.g.fillRect(140, 0, 160, 150)
  const r = rng(31)
  // far: hazy blocks, a water tank, a mast
  const far = mk(576, 120)
  far.g.fillStyle = '#9fb4c4'
  for (let x = 0; x < 576; ) {
    const w = 20 + r() * 40
    const h = 30 + r() * 60
    far.g.fillRect(x, 120 - h, w, h)
    if (r() < 0.25) far.g.fillRect(x + w / 2 - 6, 108 - h, 12, 10), far.g.fillRect(x + w / 2 - 1, 116 - h, 2, 6)
    x += w + 3
  }
  const hz = far.g.createLinearGradient(0, 0, 0, 120)
  hz.addColorStop(0, 'rgba(220,230,235,0.2)')
  hz.addColorStop(1, 'rgba(246,217,168,0.55)')
  far.g.globalCompositeOperation = 'source-atop'
  far.g.fillStyle = hz
  far.g.fillRect(0, 0, 576, 120)
  far.g.globalCompositeOperation = 'source-over'
  // mid: bungalows with zinc roofs, painted walls, doors, a mango tree
  const mid = mk(576, 160)
  for (let x = 0, i = 0; x < 576; i++) {
    const w = 60 + r() * 40
    const h = 50 + r() * 30
    const top = 160 - h
    const wall = ['#e6d5b8', '#d7c19a', '#c9d6c0', '#e3c4a8', '#cfd3dc'][i % 5]!
    const wg = mid.g.createLinearGradient(x, 0, x + w, 0)
    wg.addColorStop(0, shade(wall, -0.12))
    wg.addColorStop(1, wall)
    mid.g.fillStyle = wg
    mid.g.fillRect(x, top, w, h)
    // roof
    mid.g.fillStyle = '#7f868c'
    mid.g.beginPath()
    mid.g.moveTo(x - 4, top + 2)
    mid.g.lineTo(x + w / 2, top - 14)
    mid.g.lineTo(x + w + 4, top + 2)
    mid.g.closePath()
    mid.g.fill()
    mid.g.fillStyle = 'rgba(150,80,40,0.35)'
    mid.g.fillRect(x - 4, top - 2, w + 8, 4)
    // door + windows with burglar-proof bars
    mid.g.fillStyle = '#6b4a2f'
    mid.g.fillRect(x + w / 2 - 6, 160 - 26, 12, 26)
    for (const wx of [x + 8, x + w - 22]) {
      mid.g.fillStyle = '#35505e'
      mid.g.fillRect(wx, top + 14, 14, 14)
      mid.g.strokeStyle = 'rgba(30,30,30,0.6)'
      mid.g.lineWidth = 0.8
      for (let k = 3; k < 14; k += 3.5) {
        mid.g.beginPath()
        mid.g.moveTo(wx + k, top + 14)
        mid.g.lineTo(wx + k, top + 28)
        mid.g.stroke()
      }
    }
    // a fence wall in front
    mid.g.fillStyle = shade(wall, -0.25)
    mid.g.fillRect(x, 160 - 10, w + 8, 10)
    if (r() < 0.45) {
      const tx = x + w + 4
      mid.g.fillStyle = '#5a3e2a'
      mid.g.fillRect(tx - 2, 160 - 40, 4, 40)
      for (let k = 0; k < 4; k++) {
        mid.g.fillStyle = k % 2 ? '#3f7a34' : '#4f8f3e'
        mid.g.beginPath()
        mid.g.arc(tx + Math.cos(k * 1.6) * 9, 160 - 46 + Math.sin(k * 1.6) * 6, 13, 0, Math.PI * 2)
        mid.g.fill()
      }
    }
    x += w + 10
  }
  return { skyBg: sky.c, farBg: far.c, midBg: mid.c }
}

/** a goat, side view, walking; (x, y) = between its hooves */
function drawGoat(g: CanvasRenderingContext2D, x: number, y: number, face: number, t: number) {
  g.save()
  g.translate(x, y)
  g.scale(face, 1)
  groundShadow(g, 0, 0, 14, 3, 0.3)
  const step = Math.sin(t * 9) * 0.35
  g.strokeStyle = '#5a4a3a'
  g.lineWidth = 2.2
  g.lineCap = 'round'
  for (const [lx, ph] of [[-8, step], [-5, -step], [6, -step], [9, step]] as const) {
    g.beginPath()
    g.moveTo(lx, -10)
    g.lineTo(lx + Math.sin(ph) * 4, 0)
    g.stroke()
  }
  const bg = g.createLinearGradient(0, -20, 0, -8)
  bg.addColorStop(0, '#fbf8ef')
  bg.addColorStop(1, '#cfc6b0')
  g.fillStyle = bg
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 0.8
  g.beginPath()
  g.ellipse(0, -14, 12, 6.5, 0, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  // brown patch, tail
  g.fillStyle = '#8a5a3a'
  g.beginPath()
  g.ellipse(-4, -15, 4.5, 3.5, 0.3, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#e8e2d0'
  g.beginPath()
  g.ellipse(-12.5, -18, 2, 3, -0.6, 0, Math.PI * 2)
  g.fill()
  // neck + head + horns + beard
  g.fillStyle = '#efe9da'
  g.beginPath()
  g.moveTo(8, -18)
  g.lineTo(13, -26)
  g.lineTo(17, -24)
  g.lineTo(12, -13)
  g.closePath()
  g.fill()
  g.beginPath()
  g.ellipse(16, -25, 5, 3.4, 0.4, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.strokeStyle = '#6b5a48'
  g.lineWidth = 1.6
  g.beginPath()
  g.moveTo(14, -28)
  g.quadraticCurveTo(10, -34, 7, -31)
  g.stroke()
  g.fillStyle = '#d8cfbb'
  g.beginPath()
  g.ellipse(12.5, -25.5, 1.4, 3, 0.9, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#111'
  g.beginPath()
  g.arc(17, -26, 0.9, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#cfc6b0'
  g.beginPath()
  g.moveTo(18, -22)
  g.lineTo(19, -17)
  g.lineTo(20.5, -22)
  g.closePath()
  g.fill()
  g.restore()
}

onMounted(() => {
  const g = hidpi(cv.value!, W, H)
  const r = rng(4242)
  const GROUND = 300
  const me = lookFromSim(useSimStore().look)
  const fx = new Particles()
  let runPh = 0
  const { skyBg, farBg, midBg } = paintBackdrop()
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
      for (const c of coins) if (!c.got && Math.abs(c.x - (p.x + 9)) < 14 && Math.abs(c.y - (p.y + 15)) < 18) (c.got = true), (score += 10), emit('score', score), fx.burst(c.x, c.y, 8, ['#fff3b0', '#f5c242'], 70, 0.35, 1.6, 0)
      // goats: walk, turn at edges, stomp or get butted
      for (const gt of goats) {
        if (!gt.alive || Math.abs(gt.x - p.x) > 400) continue
        gt.x += gt.vx * dt
        const onGround = solids.some((s) => s.y === GROUND && gt.x + 12 > s.x && gt.x + 12 < s.x + s.w)
        if (!onGround) (gt.vx *= -1), (gt.x += gt.vx * dt * 2)
        const gb = { x: gt.x, y: gt.y, w: 24, h: 22 }
        if (hit(p, gb)) {
          if (p.vy > 50 && p.y + p.h - gt.y < 14) (gt.alive = false), (p.vy = -300), (score += 50), emit('score', score), fx.burst(gt.x + 12, gt.y + 8, 12, ['#ffffff', '#e8e2d0', '#ffd34d'], 110, 0.45, 2, 200)
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

    // ---- draw: sky, clouds, far skyline, houses (parallax strips)
    const t = performance.now() / 1000
    fx.update(dt)
    g.drawImage(skyBg, 0, 0, W, H)
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 97 - cam * 0.05 - t * 4) % (W + 80) + W + 80) % (W + 80) - 40
      const cy = 40 + i * 22
      g.fillStyle = 'rgba(255,255,255,0.75)'
      for (const [dx, dy, rr] of [[0, 0, 12], [12, 3, 10], [-12, 4, 9], [5, -6, 9]] as const) {
        g.beginPath()
        g.arc(cx + dx, cy + dy, rr, 0, Math.PI * 2)
        g.fill()
      }
    }
    const strip = (img: HTMLCanvasElement, k: number, y: number) => {
      const off = -((cam * k) % img.width / 2)
      for (let x = off; x < W; x += img.width / 2) g.drawImage(img, x, y, img.width / 2, img.height / 2)
    }
    strip(farBg, 0.15, 120)
    strip(midBg, 0.45, 150)
    g.save()
    g.translate(-Math.round(cam), 0)
    // the gutter under every gap: dark channel + a little water
    const view0 = cam - 10
    const gg = g.createLinearGradient(0, GROUND, 0, H)
    gg.addColorStop(0, '#2a2420')
    gg.addColorStop(1, '#0e0c0b')
    g.fillStyle = gg
    g.fillRect(view0, GROUND + 8, W + 20, H)
    g.fillStyle = 'rgba(90,120,110,0.65)'
    g.fillRect(view0, H - 16 + Math.sin(t * 2) * 1.5, W + 20, 20)
    for (const s of solids) {
      if (s.x > cam + W + 20 || s.x + s.w < cam - 20) continue
      if (s.y === GROUND) {
        fillTex(g, 'laterite', s.x, s.y, s.w, s.h + 60, 0, 0)
        const sg = g.createLinearGradient(0, s.y, 0, s.y + 40)
        sg.addColorStop(0, 'rgba(0,0,0,0)')
        sg.addColorStop(1, 'rgba(0,0,0,0.3)')
        g.fillStyle = sg
        g.fillRect(s.x, s.y, s.w, s.h + 60)
        // grass verge with tufts
        g.fillStyle = '#5f9a3a'
        g.fillRect(s.x, s.y - 1, s.w, 6)
        g.fillStyle = '#7cb84d'
        g.fillRect(s.x, s.y - 1, s.w, 2)
        g.strokeStyle = '#4c7f2c'
        g.lineWidth = 1
        for (let gx = s.x + 3; gx < s.x + s.w - 2; gx += 7) {
          g.beginPath()
          g.moveTo(gx, s.y)
          g.lineTo(gx - 1.5, s.y - 4 - ((gx * 13) % 3))
          g.moveTo(gx + 2, s.y)
          g.lineTo(gx + 3, s.y - 3 - ((gx * 7) % 3))
          g.stroke()
        }
        // gutter walls at the edges
        g.fillStyle = '#8f8a80'
        const joined = (x: number) => solids.some((o) => o !== s && o.y === GROUND && (Math.abs(o.x + o.w - x) < 1 || Math.abs(o.x - x) < 1))
        if (!joined(s.x)) g.fillRect(s.x - 2, s.y + 4, 4, s.h + 60)
        if (!joined(s.x + s.w)) g.fillRect(s.x + s.w - 2, s.y + 4, 4, s.h + 60)
      } else {
        // a concrete slab: texture, bevel, shadow underneath
        g.fillStyle = 'rgba(0,0,0,0.25)'
        g.fillRect(s.x + 3, s.y + s.h, s.w - 3, 5)
        fillTex(g, 'concrete', s.x, s.y, s.w, s.h)
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.fillRect(s.x, s.y, s.w, 2)
        g.fillStyle = 'rgba(0,0,0,0.25)'
        g.fillRect(s.x, s.y + s.h - 2, s.w, 2)
        g.fillStyle = 'rgba(0,0,0,0.15)'
        for (let bx = s.x + 23; bx < s.x + s.w; bx += 23) g.fillRect(bx, s.y, 1, s.h)
      }
    }
    for (const c of coins) if (!c.got && c.x > cam - 10 && c.x < cam + W + 10) drawCoin(g, c.x, c.y + Math.sin(t * 3 + c.x) * 1.5, 6, t)
    for (const gt of goats) if (gt.alive && gt.x > cam - 40 && gt.x < cam + W + 40) drawGoat(g, gt.x + 12, gt.y + 22, gt.vx < 0 ? -1 : 1, t + gt.x)
    // the finish: a waving green-white-green flag
    g.fillStyle = '#d7d7d7'
    g.fillRect(END, GROUND - 124, 3, 124)
    g.fillStyle = '#ffd34d'
    g.beginPath()
    g.arc(END + 1.5, GROUND - 126, 3, 0, Math.PI * 2)
    g.fill()
    for (let k = 0; k < 36; k++) {
      const wave = Math.sin(t * 5 - k * 0.25) * 2.2
      g.fillStyle = k < 12 || k >= 24 ? '#008751' : '#ffffff'
      g.fillRect(END + 3 + k, GROUND - 120 + wave, 1.2, 24)
    }
    // you, as your Sim
    if (state !== 'dead' || Math.floor(deadT * 10) % 2) {
      const fx0 = p.x + p.w / 2
      const fy = p.y + p.h
      if (p.ground) groundShadow(g, fx0, fy + 1, 10, 3, 0.35)
      const pose = !p.ground ? POSE.jump(p.vy) : Math.abs(p.vx) > 20 ? POSE.run((runPh += Math.abs(p.vx) * dt * 0.075)) : POSE.idle(t)
      drawPerson(g, fx0, fy, 0.45, p.face, me, pose)
    }
    fx.draw(g)
    g.restore()
    vignette(g, W, H, 0.25)
    // HUD
    hudPill(g, 6, 6, 76, 24)
    drawCoin(g, 20, 18, 6, t)
    hudText(g, String(score), 52, 23, 'center', 13)
    hudPill(g, W / 2 - 34, 6, 68, 24)
    hudText(g, `${Math.max(0, Math.round((END - p.x) / 10))} m`, W / 2, 23, 'center', 12, '#c8f7c5')
    hudPill(g, W - 70, 6, 64, 24)
    hudText(g, '❤'.repeat(Math.max(0, lives)), W - 38, 23, 'center', 12, '#ff6b6b')
    if (state === 'win') banner(g, W, H, 'You made it! 🇳🇬', `Score ${score}`)
    if (state === 'over') banner(g, W, H, `Game over · ${score}`, 'The goats won this time')
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" class="aspect-[288/352] w-full rounded-xl" />
</template>
