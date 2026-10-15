<script setup lang="ts">
// HighwayTrip - the shared-taxi ride between towns, shown instead of a
// loading screen: the bus rolls down the highway past farms, baobabs and
// villages; hawkers run up at the roadside markets with oranges, suya and
// pure water; the police checkpoint waves you down and through; then the
// welcome sign of the next town. Drawn on a 2D canvas so it runs on any
// phone. Tap "Skip" to arrive straight away.
const props = defineProps<{ to: string; highway: string; fare: string }>()
const emit = defineEmits<{ done: [] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const caption = ref('Driver: "Make una tighten belt o!"')
const progress = ref(0)
let raf = 0
const DUR = 14 // seconds

// events along the ride (fraction of the trip)
const CHECK = 0.42 // police checkpoint
const MARKET = 0.22 // roadside market (hawkers)
const MARKET2 = 0.68
const SIGN = 0.9

onMounted(() => {
  const c = cv.value!
  const g = c.getContext('2d')!
  const fit = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = c.clientWidth * dpr
    c.height = c.clientHeight * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  fit()
  window.addEventListener('resize', fit)
  onBeforeUnmount(() => window.removeEventListener('resize', fit))

  // seeded scenery so each ride looks the same for its route
  let seed = [...props.to].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 2147483647
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const far = Array.from({ length: 14 }, (_, i) => ({ x: i * 160 + rnd() * 80, h: 30 + rnd() * 50 }))
  const trees = Array.from({ length: 22 }, (_, i) => ({ x: i * 110 + rnd() * 60, kind: rnd() < 0.3 ? 'baobab' : rnd() < 0.6 ? 'mango' : 'neem', s: 0.8 + rnd() * 0.5 }))
  const huts = Array.from({ length: 8 }, (_, i) => ({ x: i * 340 + rnd() * 120, round: rnd() < 0.5 }))
  const oncoming = Array.from({ length: 5 }, (_, i) => ({ x: i * 420 + rnd() * 200, col: ['#c0392b', '#ecf0f1', '#2c3e50', '#f1c40f', '#16a085'][i]!, truck: rnd() < 0.35 }))

  let dist = 0 // metres of scenery scrolled
  let speed = 0
  let t0 = performance.now()
  let last = t0
  let done = false
  const hawkerItems = ['🍊', '🍢', '💧', '🥜', '🌽']

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const el = (now - t0) / 1000
    const p = Math.min(1, el / DUR)
    progress.value = p
    const W = c.clientWidth
    const H = c.clientHeight
    // speed profile: cruise, slow for markets + the checkpoint stop
    let target = 260
    const near = (at: number, w: number) => Math.abs(p - at) < w
    if (near(MARKET, 0.05) || near(MARKET2, 0.05)) target = 70
    if (near(CHECK, 0.06)) target = p < CHECK ? 25 : 60
    if (Math.abs(p - CHECK) < 0.025) target = 0
    if (p > 0.97) target = 40
    speed += (target - speed) * Math.min(1, dt * 1.6)
    dist += speed * dt

    // captions
    if (p < 0.12) caption.value = 'Driver: "Make una tighten belt o!"'
    else if (p < MARKET + 0.06) caption.value = 'Roadside market - "Buy orange! Buy pure water!"'
    else if (p < CHECK - 0.06) caption.value = `Cruising down the ${props.highway || 'highway'}…`
    else if (p < CHECK + 0.06) caption.value = 'Police checkpoint… "Oga, happy weekend!" 👮'
    else if (p < MARKET2 + 0.06) caption.value = p > MARKET2 - 0.06 ? 'Hawkers race to the window with suya and groundnuts 🍢' : 'Farms and villages roll by…'
    else if (p < SIGN) caption.value = 'Almost there…'
    else caption.value = `Welcome to ${props.to}! 🎉`

    // ---- sky (afternoon) + sun
    const sky = g.createLinearGradient(0, 0, 0, H * 0.6)
    sky.addColorStop(0, '#6db3e0')
    sky.addColorStop(1, '#f3d9a6')
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#fff3c4'
    g.beginPath()
    g.arc(W * 0.8, H * 0.16, 26, 0, Math.PI * 2)
    g.fill()
    const horizon = H * 0.55
    // far hills (slow parallax)
    g.fillStyle = '#9aa58a'
    g.beginPath()
    g.moveTo(0, horizon)
    for (const h of far) {
      const x = ((h.x - dist * 0.08) % (14 * 160) + 14 * 160) % (14 * 160) - 80
      g.lineTo(x, horizon - h.h)
      g.lineTo(x + 80, horizon)
    }
    g.lineTo(W, horizon)
    g.fill()
    // savanna
    g.fillStyle = '#c9b46a'
    g.fillRect(0, horizon, W, H - horizon)
    g.fillStyle = '#a99a52'
    for (let i = 0; i < 40; i++) {
      const x = ((i * 47 - dist * 0.35) % W + W) % W
      g.fillRect(x, horizon + 6 + (i % 5) * 7, 10, 2)
    }
    // villages (mid parallax)
    for (const h of huts) {
      const span = 8 * 340
      const x = ((h.x - dist * 0.4) % span + span) % span - 60
      if (x > W + 60) continue
      const y = horizon + 18
      g.fillStyle = '#b5764a'
      if (h.round) {
        g.fillRect(x, y - 16, 26, 16)
        g.fillStyle = '#d8c070'
        g.beginPath()
        g.moveTo(x - 4, y - 16)
        g.lineTo(x + 13, y - 34)
        g.lineTo(x + 30, y - 16)
        g.fill()
      } else {
        g.fillRect(x, y - 18, 40, 18)
        g.fillStyle = '#8f969c'
        g.fillRect(x - 3, y - 22, 46, 5)
      }
    }
    // trees (near parallax)
    for (const tr of trees) {
      const span = 22 * 110
      const x = ((tr.x - dist * 0.7) % span + span) % span - 50
      if (x > W + 50) continue
      const y = horizon + 40
      g.fillStyle = '#5b4030'
      if (tr.kind === 'baobab') {
        g.fillRect(x - 7 * tr.s, y - 34 * tr.s, 14 * tr.s, 34 * tr.s)
        g.fillStyle = '#7f8f4a'
        g.beginPath()
        g.ellipse(x, y - 40 * tr.s, 26 * tr.s, 9 * tr.s, 0, 0, Math.PI * 2)
        g.fill()
      } else {
        g.fillRect(x - 2, y - 26 * tr.s, 4, 26 * tr.s)
        g.fillStyle = tr.kind === 'mango' ? '#2f6b34' : '#4f8a3a'
        g.beginPath()
        g.arc(x, y - 32 * tr.s, 15 * tr.s, 0, Math.PI * 2)
        g.fill()
      }
    }
    // ---- road
    const roadY = H * 0.72
    g.fillStyle = '#4a4a4f'
    g.fillRect(0, roadY - 34, W, 72)
    g.fillStyle = '#d6c27a'
    g.fillRect(0, roadY - 38, W, 4)
    g.fillRect(0, roadY + 38, W, 4)
    g.fillStyle = '#f2f2f2'
    for (let x = -((dist * 1.0) % 60); x < W; x += 60) g.fillRect(x, roadY - 1, 30, 3)
    // oncoming traffic (top lane, moving left fast)
    for (const o of oncoming) {
      const span = 5 * 420
      const x = ((o.x - dist * 1.0 - el * 240) % span + span) % span - 80
      if (x > W + 80) continue
      g.fillStyle = o.col
      if (o.truck) {
        g.fillRect(x, roadY - 32, 64, 20)
        g.fillStyle = '#6b4a2f'
        g.fillRect(x + 16, roadY - 40, 46, 10)
      } else g.fillRect(x, roadY - 28, 40, 14)
      g.fillStyle = '#111'
      g.beginPath()
      g.arc(x + 9, roadY - 12, 4, 0, Math.PI * 2)
      g.arc(x + (o.truck ? 52 : 31), roadY - 12, 4, 0, Math.PI * 2)
      g.fill()
    }
    // ---- events placed in world space (they scroll in from the right)
    const tripLen = DUR * 200 // rough metres for placing events
    const worldX = (at: number) => W * 0.35 + (at * tripLen - dist) * 1.0
    // roadside markets
    for (const m of [MARKET, MARKET2]) {
      const x = worldX(m)
      if (x < -200 || x > W + 200) continue
      for (let i = 0; i < 4; i++) {
        const sx = x - 90 + i * 55
        g.fillStyle = ['#c0392b', '#2e86c1', '#e67e22', '#27ae60'][i]!
        g.fillRect(sx - 18, roadY - 66, 36, 6)
        g.fillStyle = '#6b4a2f'
        g.fillRect(sx - 16, roadY - 60, 2, 20)
        g.fillRect(sx + 14, roadY - 60, 2, 20)
        g.fillStyle = '#d9a441'
        g.fillRect(sx - 14, roadY - 46, 28, 6)
      }
      // hawkers run toward the bus when it slows
      const rush = Math.max(0, 1 - Math.abs(p - m) / 0.05)
      for (let i = 0; i < 3; i++) {
        const hx = x - 40 + i * 40 + (W * 0.35 - x) * rush * 0.6
        const bob = Math.sin(el * 12 + i) * 2 * rush
        g.fillStyle = ['#8e44ad', '#16a085', '#d35400'][i]!
        g.fillRect(hx - 5, roadY - 54 + bob, 10, 16)
        g.fillStyle = '#5a3825'
        g.beginPath()
        g.arc(hx, roadY - 59 + bob, 5, 0, Math.PI * 2)
        g.fill()
        g.font = '14px sans-serif'
        g.fillText(hawkerItems[(i + Math.round(m * 10)) % hawkerItems.length]!, hx - 8, roadY - 66 + bob)
      }
    }
    // police checkpoint: drums + a plank across, an officer waving
    {
      const x = worldX(CHECK) + 70
      if (x > -100 && x < W + 100) {
        for (let i = 0; i < 3; i++) {
          g.fillStyle = i % 2 ? '#e74c3c' : '#ecf0f1'
          g.fillRect(x + i * 14 - 20, roadY + 6, 12, 22)
        }
        const open = p > CHECK + 0.01
        g.save()
        g.translate(x - 22, roadY + 4)
        g.rotate(open ? -1.2 : 0)
        g.fillStyle = '#f1c40f'
        g.fillRect(0, -3, 60, 5)
        g.restore()
        g.fillStyle = '#2c3e50'
        g.fillRect(x + 32, roadY - 70, 12, 26)
        g.fillStyle = '#4a2e1f'
        g.beginPath()
        g.arc(x + 38, roadY - 76, 6, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#111'
        g.fillRect(x + 31, roadY - 84, 14, 4)
        // waving arm
        g.save()
        g.translate(x + 44, roadY - 66)
        g.rotate(open ? Math.sin(el * 8) * 0.6 - 0.8 : -0.2)
        g.fillStyle = '#2c3e50'
        g.fillRect(0, -2, 16, 4)
        g.restore()
        g.fillStyle = '#fff'
        g.font = 'bold 10px sans-serif'
        g.fillText('POLICE CHECKPOINT', x - 30, roadY - 90)
      }
    }
    // welcome sign
    {
      const x = worldX(SIGN) + 120
      if (x > -160 && x < W + 160) {
        g.fillStyle = '#555'
        g.fillRect(x - 2, roadY - 110, 4, 72)
        g.fillRect(x + 118, roadY - 110, 4, 72)
        g.fillStyle = '#1f6f4a'
        g.fillRect(x - 10, roadY - 128, 140, 40)
        g.fillStyle = '#fff'
        g.font = 'bold 13px sans-serif'
        g.textAlign = 'center'
        g.fillText(`WELCOME TO ${props.to.toUpperCase()}`, x + 60, roadY - 110)
        g.font = '9px sans-serif'
        g.fillText('Kaduna State · Centre of Learning', x + 60, roadY - 96)
        g.textAlign = 'left'
      }
    }
    // ---- our bus (bottom lane), bouncing gently
    const bx = W * 0.35
    const by = roadY + 12 + Math.sin(el * 14) * (speed > 30 ? 1 : 0)
    g.fillStyle = '#f2c230'
    g.fillRect(bx - 60, by - 30, 120, 34)
    g.fillStyle = '#1f6f4a'
    g.fillRect(bx - 60, by - 6, 120, 6)
    g.fillStyle = '#9fd0e6'
    for (let i = 0; i < 5; i++) g.fillRect(bx - 52 + i * 22, by - 25, 17, 12)
    g.fillStyle = '#9fd0e6'
    g.fillRect(bx + 50, by - 25, 9, 14)
    // luggage on the roof rack
    g.fillStyle = '#7a5230'
    g.fillRect(bx - 40, by - 40, 30, 10)
    g.fillStyle = '#2e86c1'
    g.fillRect(bx - 6, by - 38, 22, 8)
    g.fillStyle = '#c0392b'
    g.fillRect(bx + 18, by - 39, 16, 9)
    g.fillStyle = '#111'
    const wheel = (wx: number) => {
      g.beginPath()
      g.arc(wx, by + 6, 9, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#888'
      g.lineWidth = 2
      const a = dist / 9
      g.beginPath()
      g.moveTo(wx, by + 6)
      g.lineTo(wx + Math.cos(a) * 7, by + 6 + Math.sin(a) * 7)
      g.stroke()
    }
    wheel(bx - 38)
    wheel(bx + 38)
    // dust behind when moving fast
    if (speed > 120) {
      g.fillStyle = 'rgba(210,190,140,0.5)'
      for (let i = 0; i < 4; i++) {
        g.beginPath()
        g.arc(bx - 70 - i * 12 - ((el * 60) % 12), by + 2 - i * 2, 6 + i * 2, 0, Math.PI * 2)
        g.fill()
      }
    }

    if (p >= 1 && !done) {
      done = true
      setTimeout(() => emit('done'), 600)
    }
    if (!done || p < 1) raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="fixed inset-0 z-[90] flex flex-col bg-black text-white">
    <canvas ref="cv" class="h-full w-full" />
    <div class="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 bg-gradient-to-b from-black/50 to-transparent p-4">
      <div class="font-display text-xl font-semibold drop-shadow">🚌 On the road to {{ to }}</div>
      <div class="text-xs opacity-80">{{ highway || 'Back to Kaduna' }} · fare {{ fare }}</div>
    </div>
    <div class="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-5">
      <div class="rounded-full bg-black/50 px-4 py-1.5 text-center text-sm font-semibold">{{ caption }}</div>
      <div class="h-1.5 w-[min(420px,80vw)] overflow-hidden rounded-full bg-white/30"><div class="h-full bg-emerald-400" :style="{ width: `${progress * 100}%` }" /></div>
      <button class="rounded-full bg-white/20 px-4 py-1 text-xs font-bold" @click="emit('done')">Skip ›</button>
    </div>
  </div>
</template>
