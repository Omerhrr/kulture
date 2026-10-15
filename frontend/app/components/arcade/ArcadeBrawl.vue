<script setup lang="ts">
// Kaduna Street Brawl - an original 1v1 fighting game. Beat three street
// champions (best of 3 rounds each). A punch, B kick, Down blocks, Up
// jumps. Land hits to fill your power bar; when full, Down + A throws a
// suya fireball.
import { took, runLoop, makePad, type Pad } from '~/utils/arcade'

/** online: live head-to-head with a friend. The host runs the fight and
 *  streams snapshots; the guest streams its buttons (relayed by the server). */
const props = defineProps<{ pad: Pad; online?: { peer: string; peerName: string; host: boolean } | null }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
let stop = () => {}

type Act = 'idle' | 'walk' | 'punch' | 'kick' | 'block' | 'hurt' | 'special' | 'ko' | 'jump'
interface F { x: number; y: number; vy: number; face: number; hp: number; pow: number; act: Act; t: number; hitDone: boolean; color: string; skin: string; name: string; cap: string }
const RIVALS = [
  { name: 'Big Sani', color: '#c0392b', skin: '#5a3825', cap: '#222', level: 0.5 },
  { name: 'Halima Hurricane', color: '#8e44ad', skin: '#7a4e33', cap: '#f1c40f', level: 0.7 },
  { name: 'Chuks Thunder', color: '#1f3b5a', skin: '#4a2e1f', cap: '#e74c3c', level: 0.9 }
]
const DUR: Record<string, number> = { punch: 0.28, kick: 0.42, hurt: 0.3, special: 0.5 }
const DMG: Record<string, number> = { punch: 7, kick: 11 }
const REACH: Record<string, number> = { punch: 34, kick: 44 }

onMounted(() => {
  const g = cv.value!.getContext('2d')!
  const FLOOR = 290
  const mk = (x: number, face: number, c: Partial<F>): F => ({ x, y: FLOOR, vy: 0, face, hp: 100, pow: 0, act: 'idle', t: 0, hitDone: false, color: '#2e7d5b', skin: '#6e4630', name: 'You', cap: '#efe8d6', ...c })
  let stage = 0
  const on = props.online ?? null
  const PEER = { name: on?.peerName ?? 'Friend', color: '#1f3b5a', skin: '#4a2e1f', cap: '#e74c3c', level: 0 }
  const rival = () => (on ? PEER : RIVALS[stage]!)
  let me = mk(80, 1, {})
  let cpu = mk(210, -1, rival())
  // ---- online plumbing
  const remote = makePad()
  let lastRx = performance.now()
  let sendT = 0
  let lastPadKey = ''
  const relay = (data: unknown) => on && (window as any).__kk_ws_send?.('arcade.relay', { to: on.peer, data })
  const onFight = (ev: Event) => {
    const d = (ev as CustomEvent).detail
    if (!on || d?.type !== 'arcade.fight' || d.payload.from !== on.peer) return
    lastRx = performance.now()
    const x = d.payload.data
    if (x.k === 'pad' && on.host) {
      remote.left = x.l; remote.right = x.r; remote.up = x.u; remote.down = x.d; remote.a = x.a; remote.b = x.b
      for (const k of x.p ?? []) remote.pressed.add(k)
    } else if (x.k === 'snap' && !on.host) {
      Object.assign(me, x.me, { name: PEER.name })
      Object.assign(cpu, x.cpu, { name: 'You' })
      balls.length = 0
      for (const b of x.balls) balls.push({ x: b[0], y: b[1], vx: b[2], owner: b[3] ? cpu : me })
      timer = x.timer
      wins = x.wins
      // banners are written from the host's side: re-word them for the guest
      banner = x.done ? (x.wins[1] === 2 ? '🏆 You win the match!' : `${PEER.name} wins the match`) : String(x.banner).replace('You take the round', `${PEER.name} takes the round`).replace(/^vs .*· FIGHT!/, `vs ${PEER.name} · FIGHT!`)
      bannerT = x.bannerT
      if (x.done && !finished) {
        finished = true
        bannerT = 99
        emit('over', x.wins[1] === 2 ? 1000 : 0)
      }
    } else if (x.k === 'bye') {
      banner = `${PEER.name} left the fight`
      bannerT = 99
      finished = true
    }
  }
  window.addEventListener('kk-ws', onFight)
  onBeforeUnmount(() => {
    window.removeEventListener('kk-ws', onFight)
    if (!finished) relay({ k: 'bye' })
  })
  let wins = [0, 0]
  let timer = 60
  let banner = 'Round 1 · FIGHT!'
  let bannerT = 1.6
  let total = 0
  let finished = false
  let ai = 0
  let ending = false
  const balls: Array<{ x: number; y: number; vx: number; owner: F }> = []
  if (on) banner = on.host ? `vs ${PEER.name} · FIGHT!` : 'Connecting…'

  const start = (a: Act, f: F) => {
    if (['punch', 'kick', 'special', 'hurt', 'ko'].includes(f.act)) return
    f.act = a
    f.t = 0
    f.hitDone = false
  }
  const takeHit = (f: F, dmg: number, from: F) => {
    if (f.act === 'ko') return
    if (f.act === 'block' && f.face !== from.face) dmg = Math.round(dmg * 0.2)
    else (f.act = 'hurt'), (f.t = 0), (f.x -= f.face * 10)
    f.hp = Math.max(0, f.hp - dmg)
    from.pow = Math.min(100, from.pow + dmg * 1.6)
    if (f.hp === 0) f.act = 'ko'
  }
  const nextRound = () => {
    const hpLeft = me.hp
    me = mk(80, 1, {})
    cpu = mk(210, -1, rival())
    balls.length = 0
    timer = 60
    void hpLeft
  }
  const endRound = () => {
    const iWon = me.hp > cpu.hp
    wins[iWon ? 0 : 1]++
    if (iWon) total += 300 + me.hp * 5
    emit('score', total)
    if (on && (wins[0] === 2 || wins[1] === 2)) {
      banner = wins[0] === 2 ? '🏆 You win the match!' : `${PEER.name} wins the match`
      bannerT = 99
      finished = true
      if (wins[0] === 2) total += 1000
      emit('score', total)
      emit('over', total)
      return
    }
    if (wins[0] === 2) {
      stage++
      if (stage >= RIVALS.length) {
        banner = '🏆 Champion of Kaduna!'
        bannerT = 99
        finished = true
        total += 2000
        emit('score', total)
        emit('over', total)
        return
      }
      banner = `Next: ${RIVALS[stage]!.name}`
      wins = [0, 0]
    } else if (wins[1] === 2) {
      banner = `${cpu.name} wins · Game over`
      bannerT = 99
      finished = true
      emit('over', total)
      return
    } else banner = `Round ${wins[0] + wins[1] + 1} · FIGHT!`
    bannerT = 1.6
    nextRound()
  }

  const update = (f: F, o: F, dt: number) => {
    f.t += dt
    if (f.act === 'ko') return
    if (DUR[f.act] && f.t > DUR[f.act]!) f.act = 'idle'
    // jump physics
    if (f.y < FLOOR || f.vy < 0) {
      f.vy += 1100 * dt
      f.y += f.vy * dt
      if (f.y >= FLOOR) (f.y = FLOOR), (f.vy = 0)
    }
    // strike lands at mid-animation
    if ((f.act === 'punch' || f.act === 'kick') && !f.hitDone && f.t > DUR[f.act]! * 0.45) {
      f.hitDone = true
      const dx = (o.x - f.x) * f.face
      if (dx > 0 && dx < REACH[f.act]! && Math.abs(o.y - f.y) < 40) takeHit(o, DMG[f.act]!, f)
    }
    if (f.act === 'special' && !f.hitDone && f.t > 0.2) {
      f.hitDone = true
      balls.push({ x: f.x + f.face * 20, y: f.y - 40, vx: f.face * 220, owner: f })
    }
    f.x = Math.max(16, Math.min(W - 16, f.x))
    if (Math.abs(f.x - o.x) < 26) f.x = o.x - f.face * 26
    if (f.act === 'idle' || f.act === 'walk' || f.act === 'block') f.face = o.x > f.x ? 1 : -1
  }

  function control(f: F, pad: Pad, dt: number) {
    const free = !['punch', 'kick', 'special', 'hurt'].includes(f.act)
    if (free) {
      if (pad.down) f.act = 'block'
      else {
        let mv = 0
        if (pad.left) mv -= 1
        if (pad.right) mv += 1
        f.x += mv * 110 * dt
        f.act = mv ? 'walk' : 'idle'
      }
      if (took(pad, 'up') && f.y >= FLOOR) f.vy = -420
    }
    if (took(pad, 'a')) {
      if (pad.down && f.pow >= 100) (f.pow = 0), start('special', f)
      else start('punch', f)
    }
    if (took(pad, 'b')) start('kick', f)
  }

  stop = runLoop((dt) => {
    if (on) {
      sendT -= dt
      const now = performance.now()
      if (!finished && now - lastRx > 8000 && (on.host ? true : banner !== 'Connecting…' || now - lastRx > 15000)) {
        banner = 'Connection lost'
        bannerT = 99
        finished = true
      }
      if (!on.host) {
        // guest: stream buttons (immediately on a press), render host snapshots
        const p = [...props.pad.pressed]
        props.pad.pressed.clear()
        const pk = `${+props.pad.left}${+props.pad.right}${+props.pad.up}${+props.pad.down}${+props.pad.a}${+props.pad.b}`
        if (p.length || pk !== lastPadKey || sendT <= 0) {
          relay({ k: 'pad', l: props.pad.left, r: props.pad.right, u: props.pad.up, d: props.pad.down, a: props.pad.a, b: props.pad.b, p })
          lastPadKey = pk
          sendT = 0.25
        }
      } else if (sendT <= 0) {
        sendT = 0.05
        const pick = (f: F) => ({ x: Math.round(f.x), y: Math.round(f.y), vy: f.vy, face: f.face, hp: f.hp, pow: Math.round(f.pow), act: f.act, t: f.t, color: f.color, skin: f.skin, cap: f.cap })
        // the guest is the right-hand fighter: send it as-is, names fixed per side
        relay({ k: 'snap', me: pick(me), cpu: pick(cpu), balls: balls.map((b) => [Math.round(b.x), Math.round(b.y), b.vx, b.owner === cpu ? 1 : 0]), timer, wins, banner, bannerT, done: finished })
      }
    }
    if (bannerT > 0) bannerT -= dt
    const live = (!on || on.host) && bannerT <= 0 && !finished && !ending && me.act !== 'ko' && cpu.act !== 'ko'
    if (live) {
      timer -= dt
      // ---- you (and, online, your friend's relayed buttons drive the rival)
      control(me, props.pad, dt)
      if (on) control(cpu, remote, dt)
      // ---- CPU
      const lvl = rival().level
      ai -= dt
      const dist = Math.abs(cpu.x - me.x)
      if (!on && !['punch', 'kick', 'special', 'hurt'].includes(cpu.act)) {
        if ((me.act === 'punch' || me.act === 'kick') && dist < 50 && Math.random() < lvl * 0.08) cpu.act = 'block'
        else if (ai <= 0) {
          ai = 0.25 + (1 - lvl) * 0.5 * Math.random()
          if (cpu.pow >= 100 && dist > 80) (cpu.pow = 0), start('special', cpu)
          else if (dist < 40) start(Math.random() < 0.6 ? 'punch' : 'kick', cpu)
          else cpu.act = 'walk'
        }
        if (cpu.act === 'walk') cpu.x += (me.x > cpu.x ? 1 : -1) * (70 + lvl * 50) * dt
        if (cpu.act === 'block' && Math.random() < 0.02) cpu.act = 'idle'
      }
      update(me, cpu, dt)
      update(cpu, me, dt)
      for (const b of balls) {
        b.x += b.vx * dt
        const tgt = b.owner === me ? cpu : me
        if (Math.abs(b.x - tgt.x) < 16 && Math.abs(b.y - (tgt.y - 40)) < 30) (b.vx = 0), takeHit(tgt, 18, b.owner)
      }
      for (let i = balls.length - 1; i >= 0; i--) if (balls[i]!.vx === 0 || balls[i]!.x < -20 || balls[i]!.x > W + 20) balls.splice(i, 1)
      if (me.hp === 0 || cpu.hp === 0 || timer <= 0) {
        if (timer <= 0 && me.hp === cpu.hp) cpu.hp -= 1
        banner = me.hp > cpu.hp ? 'K.O.! You take the round' : 'K.O.!'
        bannerT = 1.4
        ending = true
        setTimeout(() => ((ending = false), endRound()), 1400)
      }
    }

    // ---- draw: Kaduna street at dusk
    const sky = g.createLinearGradient(0, 0, 0, FLOOR)
    sky.addColorStop(0, '#2c1e4a')
    sky.addColorStop(1, '#e8774a')
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#3b2b3a'
    for (let i = 0; i < 6; i++) g.fillRect(i * 52 - 6, 150 + (i % 2) * 24, 46, 140)
    g.fillStyle = '#ffcf6b'
    for (let i = 0; i < 6; i++) for (let w = 0; w < 3; w++) if ((i + w) % 2) g.fillRect(i * 52 + 6, 170 + (i % 2) * 24 + w * 30, 8, 10)
    g.fillStyle = '#4a4a50'
    g.fillRect(0, FLOOR, W, H - FLOOR)
    g.fillStyle = '#e0c040'
    for (let x = 0; x < W; x += 40) g.fillRect(x, FLOOR + 30, 22, 3)
    // crowd silhouettes
    g.fillStyle = '#1d1520'
    for (let i = 0; i < 14; i++) g.fillRect(i * 21, FLOOR - 26 - (i % 3) * 4, 14, 30)

    const draw = (f: F) => {
      const x = f.x
      const y = f.y
      const lean = f.act === 'hurt' ? -f.face * 6 : 0
      if (f.act === 'ko') {
        g.fillStyle = f.color
        g.fillRect(x - 22, y - 12, 44, 12)
        g.fillStyle = f.skin
        g.fillRect(x + f.face * 22, y - 12, 10, 10)
        return
      }
      // legs
      g.fillStyle = '#2b3440'
      const kickOut = f.act === 'kick' && f.t > 0.12 && f.t < 0.34
      g.fillRect(x - 9, y - 26, 7, 26)
      if (kickOut) g.fillRect(x, y - 30, f.face * 36, 7)
      else g.fillRect(x + 2, y - 26, 7, 26)
      // body
      g.fillStyle = f.color
      g.fillRect(x - 12 + lean, y - 58, 24, 34)
      // head + cap
      g.fillStyle = f.skin
      g.fillRect(x - 8 + lean, y - 74, 16, 16)
      g.fillStyle = f.cap
      g.fillRect(x - 8 + lean, y - 78, 16, 5)
      g.fillStyle = '#000'
      g.fillRect(x + f.face * 3 + lean, y - 69, 2, 2)
      // arms
      g.fillStyle = f.skin
      const punchOut = (f.act === 'punch' && f.t > 0.06 && f.t < 0.22) || (f.act === 'special' && f.t < 0.35)
      if (f.act === 'block') g.fillRect(x + f.face * 6 - 3, y - 62, 7, 24)
      else if (punchOut) g.fillRect(x, y - 52, f.face * 34, 7)
      else g.fillRect(x + f.face * 8 - 3, y - 54, 6, 20)
    }
    draw(cpu)
    draw(me)
    for (const b of balls) {
      g.fillStyle = '#ff7b00'
      g.beginPath()
      g.arc(b.x, b.y, 9, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#ffd34d'
      g.beginPath()
      g.arc(b.x, b.y, 5, 0, Math.PI * 2)
      g.fill()
    }
    // HUD bars
    const bar = (x: number, f: F, flip: boolean) => {
      g.fillStyle = '#300'
      g.fillRect(x, 10, 118, 10)
      g.fillStyle = f.hp > 30 ? '#2ecc71' : '#e74c3c'
      const w = (118 * f.hp) / 100
      g.fillRect(flip ? x + 118 - w : x, 10, w, 10)
      g.fillStyle = '#f1c40f'
      g.fillRect(flip ? x + 118 - (118 * f.pow) / 100 : x, 23, (118 * f.pow) / 100, 3)
      g.fillStyle = '#fff'
      g.font = 'bold 10px sans-serif'
      g.textAlign = flip ? 'right' : 'left'
      g.fillText(f.name, flip ? x + 118 : x, 38)
    }
    bar(8, me, false)
    bar(W - 126, cpu, true)
    g.textAlign = 'center'
    g.font = 'bold 14px sans-serif'
    g.fillStyle = '#fff'
    g.fillText(String(Math.max(0, Math.ceil(timer))), W / 2, 22)
    g.font = 'bold 10px sans-serif'
    g.fillText(`${'●'.repeat(wins[0]!)}${'○'.repeat(2 - wins[0]!)}  vs  ${'●'.repeat(wins[1]!)}${'○'.repeat(2 - wins[1]!)}`, W / 2, 38)
    if (bannerT > 0) {
      g.fillStyle = 'rgba(0,0,0,0.5)'
      g.fillRect(0, 120, W, 46)
      g.fillStyle = '#ffd34d'
      g.font = 'bold 18px sans-serif'
      g.fillText(banner, W / 2, 150)
    }
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" :width="W" :height="H" class="w-full rounded-xl" />
</template>
