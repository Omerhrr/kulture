<script setup lang="ts">
// Stick Clash - two stickmen with staffs on a rooftop. Every hit raises
// the target's damage %, and the higher it is the further they fly. Knock
// the other one off the roof 3 times. A swings, B dashes, Up jumps (double
// jump in the air).
import { took, runLoop, type Pad } from '~/utils/arcade'

const props = defineProps<{ pad: Pad }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
let stop = () => {}

interface S { x: number; y: number; vx: number; vy: number; face: number; dmg: number; stocks: number; jumps: number; swing: number; dash: number; stun: number; color: string; hitDone: boolean }

onMounted(() => {
  const g = cv.value!.getContext('2d')!
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

    // ---- draw: night rooftop over Kaduna
    g.fillStyle = '#141a2e'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#f5f1d0'
    g.beginPath()
    g.arc(230, 52, 18, 0, Math.PI * 2)
    g.fill()
    for (let i = 0; i < 9; i++) {
      g.fillStyle = '#20283f'
      g.fillRect(i * 34 - 4, 280 + (i % 3) * 10, 30, 90)
      g.fillStyle = '#e8c35a'
      if (i % 2) g.fillRect(i * 34 + 6, 296 + (i % 3) * 10, 5, 6)
    }
    for (const p of plats) {
      g.fillStyle = p.h > 10 ? '#5a5f6e' : '#8d6e4f'
      g.fillRect(p.x, p.y, p.w, p.h)
    }
    const stick = (s: S) => {
      const x = s.x
      const y = s.y
      g.strokeStyle = s.color
      g.lineWidth = 3
      g.lineCap = 'round'
      const run = Math.abs(s.vx) > 30 && onGround(s) ? Math.sin(t * 16) * 7 : 0
      g.beginPath()
      g.moveTo(x, y - 20)
      g.lineTo(x - 5 + run, y)
      g.moveTo(x, y - 20)
      g.lineTo(x + 5 - run, y)
      g.moveTo(x, y - 20)
      g.lineTo(x, y - 40)
      g.stroke()
      g.beginPath()
      g.arc(x, y - 46, 6, 0, Math.PI * 2)
      g.stroke()
      // staff swing arc
      const a = s.swing > 0 ? (1 - s.swing / 0.32) * Math.PI * 1.1 - 1.2 : -0.6
      const hx = x + s.face * 4
      const hy = y - 34
      g.strokeStyle = '#a0723c'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(hx, hy)
      g.lineTo(hx + s.face * Math.cos(a) * 34, hy + Math.sin(a) * 34)
      g.stroke()
    }
    stick(cpu)
    stick(me)
    g.font = 'bold 12px sans-serif'
    g.fillStyle = '#fff'
    g.textAlign = 'left'
    g.fillText(`You ${Math.round(me.dmg)}%  ${'♥'.repeat(Math.max(0, me.stocks))}`, 8, 18)
    g.textAlign = 'right'
    g.fillStyle = '#ff8a7a'
    g.fillText(`${'♥'.repeat(Math.max(0, cpu.stocks))}  ${Math.round(cpu.dmg)}% Red`, W - 8, 18)
    if (msgT > 0) {
      g.textAlign = 'center'
      g.fillStyle = '#ffd34d'
      g.font = 'bold 18px sans-serif'
      g.fillText(msg, W / 2, 110)
    }
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" :width="W" :height="H" class="w-full rounded-xl" />
</template>
