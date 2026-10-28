<script setup lang="ts">
// Stick Clash - two fighters with staffs on a rooftop. Every hit raises
// the target's damage %, and the higher it is the further they fly. Knock
// the other one off the roof 3 times. A swings, B dashes, Up jumps (double
// jump in the air).
import { took, runLoop, rng, type Pad } from '~/utils/arcade'
import { hidpi, drawPerson, POSE, lookFromSim, groundShadow, hudPill, hudText, banner, vignette, fillTex, Particles, type Pose } from '~/utils/arcadeArt'
import { useSimStore } from '~/stores/sim'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
let stop = () => {}

/** night sky, city lights and the main roof, painted once */
function paintRoof(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  const g = hidpi(cv, W, H)
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#070b1c')
  sky.addColorStop(0.6, '#1b2347')
  sky.addColorStop(1, '#3a2a4a')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  const r = rng(5)
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`
    g.fillRect(r() * W, r() * 180, r() < 0.1 ? 1.6 : 1, r() < 0.1 ? 1.6 : 1)
  }
  const mg = g.createRadialGradient(226, 54, 4, 226, 54, 60)
  mg.addColorStop(0, 'rgba(255,250,220,0.5)')
  mg.addColorStop(1, 'rgba(255,250,220,0)')
  g.fillStyle = mg
  g.fillRect(160, 0, 128, 120)
  g.fillStyle = '#f5f1d0'
  g.beginPath()
  g.arc(226, 54, 16, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(0,0,0,0.08)'
  g.beginPath()
  g.arc(221, 50, 4, 0, Math.PI * 2)
  g.arc(231, 60, 3, 0, Math.PI * 2)
  g.fill()
  // city: two layers of blocks with lit windows
  for (const [base, col, lit] of [[250, '#1a2038', 0.25], [300, '#11152a', 0.4]] as const) {
    for (let x = -8; x < W; ) {
      const w = 22 + r() * 34
      const h = 40 + r() * 90
      g.fillStyle = col
      g.fillRect(x, base - h, w, h + 120)
      for (let wy = base - h + 6; wy < H; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) if (r() < lit) (g.fillStyle = r() < 0.8 ? '#ffcf6b' : '#a8d4ec'), g.fillRect(wx, wy, 3, 4)
      x += w + 3
    }
  }
  // the roof: parapet, concrete deck, water tanks, a dish
  const R = 270
  fillTex(g, 'concrete', 30, R, 228, 14)
  g.fillStyle = 'rgba(0,0,0,0.25)'
  g.fillRect(30, R + 10, 228, 4)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(30, R, 228, 1.5)
  g.fillStyle = '#2b2f3e'
  g.fillRect(36, R + 14, 216, H - R)
  for (let wy = R + 24; wy < H; wy += 22) for (let wx = 46; wx < 244; wx += 26) (g.fillStyle = r() < 0.5 ? '#ffcf6b' : '#1a1d28'), g.fillRect(wx, wy, 12, 12)
  for (const tx of [44, 226]) {
    const tg = g.createLinearGradient(tx - 9, 0, tx + 9, 0)
    tg.addColorStop(0, '#0e0e10')
    tg.addColorStop(0.5, '#3a3a40')
    tg.addColorStop(1, '#0e0e10')
    g.fillStyle = tg
    g.fillRect(tx - 9, R - 22, 18, 22)
    g.fillStyle = '#2a2a30'
    g.beginPath()
    g.ellipse(tx, R - 22, 9, 3, 0, 0, Math.PI * 2)
    g.fill()
  }
  g.strokeStyle = '#8a8f99'
  g.lineWidth = 1.5
  g.beginPath()
  g.arc(140, R - 12, 8, Math.PI * 0.85, Math.PI * 1.85)
  g.stroke()
  g.beginPath()
  g.moveTo(140, R - 12)
  g.lineTo(140, R)
  g.stroke()
  return cv
}

interface S { x: number; y: number; vx: number; vy: number; face: number; dmg: number; stocks: number; jumps: number; swing: number; dash: number; stun: number; color: string; hitDone: boolean }

onMounted(() => {
  const g = hidpi(cv.value!, W, H)
  const meLook = lookFromSim(useSimStore().look)
  const cpuLook = { skin: '#4a2e1f', hair: '#141114', hairStyle: 'fade' as const, top: '#c0392b', sleeves: 'none' as const, bottom: '#1d1c1f', shoe: '#1d1c1f', band: '#f5f1ea' }
  const sparks = new Particles()
  const prevDmg = new Map<S, number>()
  const stageBg = paintRoof()
  const plats = [
    { x: 30, y: 270, w: 228, h: 14 },
    { x: 60, y: 200, w: 60, h: 6 },
    { x: 168, y: 200, w: 60, h: 6 },
    { x: 114, y: 140, w: 60, h: 6 }
  ]
  const mk = (x: number, face: number, color: string): S => ({ x, y: 200, vx: 0, vy: 0, face, dmg: 0, stocks: 3, jumps: 2, swing: 0, dash: 0, stun: 0, color, hitDone: false })
  const me = mk(90, 1, '#111')
  const cpu = mk(198, -1, '#c0392b')
  let score = 0
  let done = false
  let msg = 'FIGHT!'
  let msgT = 1.2
  let ai = 0

  const onGround = (s: S) => plats.some((p) => s.x > p.x - 4 && s.x < p.x + p.w + 4 && Math.abs(s.y - p.y) < 2 && s.vy >= 0)
  const physics = (s: S, dt: number) => {
    s.vy += 900 * dt
    s.vx *= s.stun > 0 ? 0.995 : onGround(s) ? 0.82 : 0.96
    const oy = s.y
    s.x += s.vx * dt
    s.y += s.vy * dt
    for (const p of plats) {
      // one-way platforms: land when falling through the top
      if (s.vy >= 0 && oy <= p.y && s.y >= p.y && s.x > p.x - 4 && s.x < p.x + p.w + 4) {
        s.y = p.y
        s.vy = 0
        s.jumps = 2
      }
    }
    s.swing = Math.max(0, s.swing - dt)
    s.dash = Math.max(0, s.dash - dt)
    s.stun = Math.max(0, s.stun - dt)
  }
  const swingHit = (a: S, b: S) => {
    if (a.swing <= 0 || a.hitDone || a.swing > 0.22) return
    const dx = (b.x - a.x) * a.face
    if (dx > -4 && dx < 40 && Math.abs(b.y - a.y) < 46) {
      a.hitDone = true
      b.dmg += 9 + Math.random() * 4
      const kb = 120 + b.dmg * 4.2
      b.vx = a.face * kb
      b.vy = -kb * 0.55
      b.stun = 0.25 + b.dmg / 300
      if (a === me) (score += 10), emit('score', score)
    }
  }
  const respawn = (s: S, x: number) => {
    s.stocks--
    s.x = x
    s.y = 100
    s.vx = s.vy = 0
    s.dmg = 0
    if (me.stocks <= 0 || cpu.stocks <= 0) {
      done = true
      if (cpu.stocks <= 0) score += 500 + me.stocks * 200
      msg = cpu.stocks <= 0 ? 'You win the roof! 🏆' : 'Knocked out · Game over'
      msgT = 99
      emit('score', score)
      emit('over', score)
    } else {
      msg = s === me ? 'Ouch! -1 life' : 'Off the roof! +100'
      if (s === cpu) (score += 100), emit('score', score)
      msgT = 0.9
    }
  }

  stop = runLoop((dt, t) => {
    msgT -= dt
    if (!done) {
      // ---- you
      if (me.stun <= 0) {
        const acc = onGround(me) ? 900 : 500
        if (props.pad.left) (me.vx -= acc * dt), (me.face = -1)
        if (props.pad.right) (me.vx += acc * dt), (me.face = 1)
        me.vx = Math.max(-170, Math.min(170, me.vx))
        if (took(props.pad, 'up') && me.jumps > 0) (me.vy = -380), me.jumps--
        if (took(props.pad, 'a') && me.swing <= 0) (me.swing = 0.32), (me.hitDone = false)
        if (took(props.pad, 'b') && me.dash <= 0) (me.vx = me.face * 340), (me.dash = 0.6)
      } else props.pad.pressed.clear()
      // ---- CPU: chase, swing in range, recover toward the stage
      ai -= dt
      if (cpu.stun <= 0) {
        const dx = me.x - cpu.x
        const offStage = cpu.x < 40 || cpu.x > 248 || cpu.y > 272
        cpu.face = offStage ? (cpu.x < W / 2 ? 1 : -1) : dx > 0 ? 1 : -1
        cpu.vx += cpu.face * 700 * dt
        cpu.vx = Math.max(-150, Math.min(150, cpu.vx))
        if ((offStage && cpu.vy > 0 && cpu.jumps > 0) || (me.y < cpu.y - 40 && onGround(cpu) && Math.random() < 0.03)) (cpu.vy = -380), cpu.jumps--
        if (ai <= 0 && Math.abs(dx) < 40 && Math.abs(me.y - cpu.y) < 40 && cpu.swing <= 0) {
          cpu.swing = 0.32
          cpu.hitDone = false
          ai = 0.35 + Math.random() * 0.4
        }
      }
      physics(me, dt)
      physics(cpu, dt)
      swingHit(me, cpu)
      swingHit(cpu, me)
      if (me.y > H + 40 || me.x < -60 || me.x > W + 60) respawn(me, 90)
      if (cpu.y > H + 40 || cpu.x < -60 || cpu.x > W + 60) respawn(cpu, 198)
    }

    // ---- draw: a rooftop over Kaduna at night (backdrop painted once)
    g.drawImage(stageBg, 0, 0, W, H)
    // the side planks on their poles
    for (const p of plats.slice(1)) {
      g.fillStyle = '#3a2c22'
      g.fillRect(p.x + 6, p.y + p.h, 3, 270 - p.y - p.h)
      g.fillRect(p.x + p.w - 9, p.y + p.h, 3, 270 - p.y - p.h)
      const pg = g.createLinearGradient(0, p.y, 0, p.y + p.h + 2)
      pg.addColorStop(0, '#c49a62')
      pg.addColorStop(1, '#7a5230')
      g.fillStyle = pg
      g.fillRect(p.x, p.y, p.w, p.h + 2)
      g.fillStyle = 'rgba(0,0,0,0.25)'
      for (let k = p.x + 15; k < p.x + p.w; k += 15) g.fillRect(k, p.y, 1, p.h + 2)
    }
    const lookOf = (s: S) => (s === me ? meLook : cpuLook)
    const poseOf = (s: S): Pose => {
      if (s.stun > 0) return POSE.hurt()
      if (s.swing > 0) return POSE.swing(1 - s.swing / 0.32)
      if (!onGround(s)) return POSE.jump(s.vy)
      if (Math.abs(s.vx) > 30) return POSE.run(t * 14)
      const p = POSE.guard(t)
      return { ...p, armF: [1.2, 0.9] }
    }
    const fighter = (s: S) => {
      const ground = plats.find((p) => s.x > p.x - 4 && s.x < p.x + p.w + 4 && p.y >= s.y - 1)
      if (ground) groundShadow(g, s.x, ground.y + 1, Math.max(5, 12 - (ground.y - s.y) * 0.08), 2.5, 0.4)
      drawPerson(g, s.x, s.y, 0.6, s.face, lookOf(s), poseOf(s), { staff: 30 })
      // swing trail
      if (s.swing > 0.05 && s.swing < 0.28) {
        const k = 1 - s.swing / 0.32
        g.strokeStyle = `rgba(255,255,255,${0.35 * (1 - k)})`
        g.lineWidth = 3
        g.beginPath()
        g.arc(s.x + s.face * 4, s.y - 30, 30, s.face > 0 ? -1.6 : Math.PI + 1.6 - k * 2.4, s.face > 0 ? -1.6 + k * 2.4 : Math.PI + 1.6, false)
        g.stroke()
      }
      const prev = prevDmg.get(s) ?? s.dmg
      if (s.dmg > prev) sparks.burst(s.x, s.y - 30, 12, ['#fff3b0', '#ffb83d', '#ffffff'], 150, 0.35, 2, 150)
      prevDmg.set(s, s.dmg)
    }
    fighter(cpu)
    fighter(me)
    sparks.update(dt)
    sparks.draw(g)
    vignette(g, W, H, 0.35)
    // HUD: damage %, lives
    const card = (x: number, s: S, label: string, right: boolean) => {
      hudPill(g, x, 6, 120, 30)
      const hot = Math.min(1, s.dmg / 120)
      hudText(g, `${Math.round(s.dmg)}%`, right ? x + 112 : x + 8, 27, right ? 'right' : 'left', 16, `rgb(255,${Math.round(255 - hot * 160)},${Math.round(255 - hot * 200)})`)
      hudText(g, label, right ? x + 64 : x + 56, 19, 'center', 9, 'rgba(255,255,255,0.8)')
      hudText(g, '♥'.repeat(Math.max(0, s.stocks)), right ? x + 64 : x + 56, 32, 'center', 10, '#ff6b6b')
    }
    card(6, me, 'YOU', false)
    card(W - 126, cpu, 'RED', true)
    if (msgT > 0) banner(g, W, H, msg, '', 110)
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" class="aspect-[288/352] w-full rounded-xl" />
</template>
