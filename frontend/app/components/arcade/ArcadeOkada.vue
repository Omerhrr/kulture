<script setup lang="ts">
// Okada Dash - endless top-down ride up a 3-lane Kaduna road. Swerve
// between danfos, cars, kekes and potholes, grab fuel cans. Gets faster.
import { took, runLoop, rng, type Pad } from '~/utils/arcade'
import { hidpi, fillTex, drawCarTop, drawKekeTop, drawOkadaTop, drawTreeTop, drawJerrycan, hudPill, hudText, meter, banner, vignette, pattern, Particles } from '~/utils/arcadeArt'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
const ROAD_L = 54
const ROAD_W = 180
const CAR_COLORS = ['#e8e8ea', '#1f2a44', '#8e1b1b', '#2e5e3e', '#9aa0a6', '#c46a1a']
let stop = () => {}

type Kind = 'danfo' | 'car' | 'keke' | 'hole' | 'fuel'
interface Thing { x: number; y: number; kind: Kind; vy: number; color: string; wob: number }

onMounted(() => {
  const g = hidpi(cv.value!, W, H)
  const r = rng()
  const LANES = [84, 144, 204]
  let lane = 1
  let px = LANES[1]!
  let speed = 160
  let dist = 0
  let fuel = 100
  let dead = false
  let deadT = 0
  let spawn = 0
  const things: Thing[] = []
  const fx = new Particles()
  // swipe left/right
  let sx = 0
  cv.value!.addEventListener('touchstart', (e) => (sx = e.touches[0]!.clientX), { passive: true })
  cv.value!.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0]!.clientX - sx
    if (Math.abs(dx) > 20) props.pad.pressed.add(dx > 0 ? 'right' : 'left')
  })
  // roadside: trees, rooftops and street poles, seeded per 60-unit row
  const side = (row: number) => {
    const h = Math.abs(Math.sin(row * 12.9898) * 43758.5453) % 1
    const h2 = Math.abs(Math.sin(row * 78.233) * 12345.678) % 1
    return { h, h2 }
  }

  stop = runLoop((dt, t) => {
    if (!dead) {
      if (took(props.pad, 'left')) lane = Math.max(0, lane - 1)
      if (took(props.pad, 'right')) lane = Math.min(2, lane + 1)
      px += (LANES[lane]! - px) * Math.min(1, dt * 14)
      speed += dt * 6
      dist += speed * dt
      fuel -= dt * 4
      spawn -= dt
      if (spawn <= 0) {
        spawn = Math.max(0.35, 1.1 - speed / 600) * (0.6 + r())
        const k = r()
        const kind: Kind = k < 0.22 ? 'danfo' : k < 0.45 ? 'car' : k < 0.7 ? 'keke' : k < 0.88 ? 'hole' : 'fuel'
        things.push({ x: LANES[Math.floor(r() * 3)]!, y: -60, kind, vy: k < 0.7 ? -40 - r() * 30 : 0, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]!, wob: r() * 6 })
      }
      for (const th of things) th.y += (speed + th.vy) * dt
      for (let i = things.length - 1; i >= 0; i--) {
        const th = things[i]!
        const h = th.kind === 'danfo' ? 56 : th.kind === 'car' ? 46 : th.kind === 'keke' ? 34 : 18
        if (Math.abs(th.x - px) < 22 && th.y + h / 2 > 268 && th.y - h / 2 < 310) {
          if (th.kind === 'fuel') {
            fuel = Math.min(100, fuel + 35)
            fx.burst(th.x, th.y, 12, ['#ffd34d', '#ffffff', '#7cf29a'], 110, 0.45, 2, 0)
            things.splice(i, 1)
            continue
          }
          dead = true
          fx.burst(px, 285, 26, ['#ffb83d', '#ff6a3d', '#666', '#ddd'], 180, 0.7, 2.6, 120)
        }
        if (th.y > H + 80) things.splice(i, 1)
      }
      if (fuel <= 0) dead = true
      const score = Math.floor(dist / 10)
      if (Math.floor(dist / 10) % 25 === 0) emit('score', score)
      if (dead) emit('over', score)
    } else deadT += dt
    fx.update(dt)

    // ---- verges: grass, footpaths, trees and rooftops
    const scroll = dist % 128
    fillTex(g, 'grass', 0, 0, ROAD_L - 14, H, 0, scroll)
    fillTex(g, 'grass', ROAD_L + ROAD_W + 14, 0, W - ROAD_L - ROAD_W - 14, H, 0, scroll)
    fillTex(g, 'concrete', ROAD_L - 14, 0, 12, H, 0, scroll)
    fillTex(g, 'concrete', ROAD_L + ROAD_W + 2, 0, 12, H, 0, scroll)
    const row0 = Math.floor(dist / 60)
    for (let k = -1; k < H / 60 + 2; k++) {
      const row = row0 - k
      const y = (dist % 60) + k * 60
      const { h, h2 } = side(row)
      for (const [x0, flip] of [[18, 0], [W - 18, 1]] as const) {
        const hh = flip ? h2 : h
        if (hh < 0.45) drawTreeTop(g, x0 + (hh - 0.2) * 14, y, 13 + hh * 8, flip)
        else if (hh < 0.7) {
          // a zinc rooftop at the edge of the frame
          g.fillStyle = 'rgba(0,0,0,0.3)'
          g.fillRect(x0 - 22 + 4, y - 18 + 4, 30, 36)
          g.save()
          g.beginPath()
          g.rect(x0 - 22, y - 18, 30, 36)
          g.clip()
          g.fillStyle = pattern(g, 'zinc', 32)
          g.fillRect(x0 - 22, y - 18, 30, 36)
          g.restore()
          g.fillStyle = 'rgba(255,255,255,0.15)'
          g.fillRect(x0 - 22, y - 18, 30, 2)
        } else {
          // a street pole + its shadow
          const lx = flip ? ROAD_L + ROAD_W + 8 : ROAD_L - 8
          g.fillStyle = 'rgba(0,0,0,0.3)'
          g.fillRect(lx, y, 22 * (flip ? -1 : 1), 3)
          g.fillStyle = '#3a3a40'
          g.beginPath()
          g.arc(lx, y, 3, 0, Math.PI * 2)
          g.fill()
        }
      }
    }
    // ---- road: asphalt, kerbs, edge lines, lane dashes
    fillTex(g, 'asphalt', ROAD_L, 0, ROAD_W, H, 0, scroll)
    const kerb = (x: number) => {
      for (let y = (dist % 24) - 24; y < H; y += 24) {
        g.fillStyle = '#f2f0ea'
        g.fillRect(x, y, 4, 12)
        g.fillStyle = '#1d1c1f'
        g.fillRect(x, y + 12, 4, 12)
      }
    }
    kerb(ROAD_L - 2)
    kerb(ROAD_L + ROAD_W - 2)
    g.fillStyle = 'rgba(245,245,240,0.85)'
    g.fillRect(ROAD_L + 6, 0, 2, H)
    g.fillRect(ROAD_L + ROAD_W - 8, 0, 2, H)
    g.fillStyle = 'rgba(245,245,240,0.8)'
    for (let y = (dist % 44) - 44; y < H; y += 44) {
      g.fillRect(112, y, 3, 22)
      g.fillRect(173, y, 3, 22)
    }
    // tyre wear in each lane
    g.fillStyle = 'rgba(0,0,0,0.12)'
    for (const lx of LANES) g.fillRect(lx - 10, 0, 5, H), g.fillRect(lx + 5, 0, 5, H)

    // ---- traffic and road hazards
    for (const th of things) {
      const wob = Math.sin(t * 3 + th.wob) * 0.6
      if (th.kind === 'danfo') drawCarTop(g, th.x + wob, th.y, 34, 58, '#f5c400', { stripes: '#151515', rack: true, brake: th.vy < -55 })
      else if (th.kind === 'car') drawCarTop(g, th.x + wob, th.y, 30, 46, th.color, { brake: th.vy < -55 })
      else if (th.kind === 'keke') drawKekeTop(g, th.x + wob, th.y)
      else if (th.kind === 'hole') {
        // a broken-edged pothole with rain water
        g.fillStyle = '#34343a'
        g.beginPath()
        for (let a = 0; a < Math.PI * 2; a += 0.6) {
          const rr = 17 + Math.sin(a * 3 + th.wob) * 3
          g.lineTo(th.x + Math.cos(a) * rr, th.y + Math.sin(a) * rr * 0.62)
        }
        g.closePath()
        g.fill()
        g.fillStyle = '#1e1e22'
        g.beginPath()
        g.ellipse(th.x, th.y + 1, 13, 7.5, 0, 0, Math.PI * 2)
        g.fill()
        const wg = g.createLinearGradient(th.x - 10, th.y - 6, th.x + 10, th.y + 6)
        wg.addColorStop(0, 'rgba(120,150,180,0.55)')
        wg.addColorStop(1, 'rgba(40,60,80,0.2)')
        g.fillStyle = wg
        g.beginPath()
        g.ellipse(th.x + 1, th.y + 2, 9, 4.5, 0, 0, Math.PI * 2)
        g.fill()
      } else drawJerrycan(g, th.x, th.y + Math.sin(t * 5 + th.wob) * 1.5)
    }
    // ---- you
    const lean = (LANES[lane]! - px) * 0.012
    if (!dead || Math.floor(deadT * 10) % 2) drawOkadaTop(g, px, 290, t, '#c0392b', '#f39c12', dead ? 0.6 : lean)
    fx.draw(g)
    // speed streaks once you are flying
    if (speed > 220 && !dead) {
      g.strokeStyle = `rgba(255,255,255,${Math.min(0.35, (speed - 220) / 300)})`
      g.lineWidth = 1
      for (let i = 0; i < 6; i++) {
        const x = ROAD_L + ((i * 53 + dist * 0.7) % ROAD_W)
        const y = (i * 97 + dist * 3) % H
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x, y + 26)
        g.stroke()
      }
    }
    vignette(g, W, H, 0.28)

    // ---- HUD
    hudPill(g, 6, 6, 84, 24)
    hudText(g, `${Math.floor(dist / 10)} m`, 48, 23, 'center', 13)
    hudPill(g, W - 120, 6, 114, 24)
    g.save()
    g.translate(W - 106, 18)
    g.scale(0.55, 0.55)
    drawJerrycan(g, 0, 0)
    g.restore()
    meter(g, W - 92, 13, 78, 9, fuel / 100, fuel > 25 ? ['#7cf29a', '#1e9e4f'] : ['#ff8a7a', '#c0392b'])
    hudPill(g, 6, 34, 84, 20)
    hudText(g, `${Math.round(speed * 0.36)} km/h`, 48, 48, 'center', 11, '#ffd34d')
    if (dead) banner(g, W, H, fuel <= 0 ? 'Out of fuel' : 'Crash!', `${Math.floor(dist / 10)} m ridden`)
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" class="aspect-[288/352] w-full rounded-xl" />
</template>
