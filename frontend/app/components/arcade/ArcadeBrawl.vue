<script setup lang="ts">
// Kaduna Street Brawl - an original 1v1 fighting game. Beat three street
// champions (best of 3 rounds each). A punch, B kick, Down blocks, Up
// jumps. Land hits to fill your power bar; when full, Down + A throws a
// suya fireball.
import { useSimStore } from '~/stores/sim'
import { took, runLoop, makePad, rng, type Pad } from '~/utils/arcade'
import { hidpi, drawPerson, POSE, lookFromSim, groundShadow, rrect, fillTex, meter, hudText, banner as bannerCard, vignette, shade, Particles, type ArcadeLook as Look, type Pose } from '~/utils/arcadeArt'

/** online: live head-to-head with a friend. The host runs the fight and
 *  streams snapshots; the guest streams its buttons (relayed by the server). */
const props = defineProps<{ pad: Pad; online?: { peer: string; peerName: string; host: boolean } | null }>()
const emit = defineEmits<{ score: [n: number]; over: [n: number] }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 288
const H = 352
let stop = () => {}

type Act = 'idle' | 'walk' | 'punch' | 'kick' | 'block' | 'hurt' | 'special' | 'ko' | 'jump'
interface F { x: number; y: number; vy: number; face: number; hp: number; pow: number; act: Act; t: number; hitDone: boolean; color: string; skin: string; name: string; cap: string; hs?: string; bot?: string; sl?: Look['sleeves']; beard?: boolean; fem?: boolean }
const RIVALS = [
  { name: 'Big Sani', color: '#c0392b', skin: '#5a3825', cap: '#222', hs: 'bald', bot: '#3a3a40', sl: 'none' as const, beard: true, level: 0.5 },
  { name: 'Halima Hurricane', color: '#8e44ad', skin: '#7a4e33', cap: '', hs: 'braids', bot: '#1f2a44', sl: 'short' as const, fem: true, level: 0.7 },
  { name: 'Chuks Thunder', color: '#1f3b5a', skin: '#4a2e1f', cap: '#e74c3c', hs: 'fade', bot: '#5a5a5e', sl: 'long' as const, level: 0.9 }
]
const DUR: Record<string, number> = { punch: 0.28, kick: 0.42, hurt: 0.3, special: 0.5 }
const DMG: Record<string, number> = { punch: 7, kick: 11 }
const REACH: Record<string, number> = { punch: 34, kick: 44 }

/** the street behind the fight: dusk sky, shopfronts, street lights, road */
function paintStage(FLOOR: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  const g = hidpi(cv, W, H)
  const sky = g.createLinearGradient(0, 0, 0, FLOOR)
  sky.addColorStop(0, '#1d1640')
  sky.addColorStop(0.45, '#6b2f5e')
  sky.addColorStop(0.8, '#e8774a')
  sky.addColorStop(1, '#ffc078')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  // low sun + haze
  const sun = g.createRadialGradient(200, 196, 4, 200, 196, 90)
  sun.addColorStop(0, 'rgba(255,240,190,0.95)')
  sun.addColorStop(0.15, 'rgba(255,190,110,0.6)')
  sun.addColorStop(1, 'rgba(255,140,80,0)')
  g.fillStyle = sun
  g.fillRect(0, 80, W, 200)
  const r = rng(9)
  // far skyline: blocks, water towers, a mast
  g.fillStyle = '#4a2a4f'
  for (let x = -10; x < W; ) {
    const w = 18 + r() * 30
    const h = 40 + r() * 70
    g.fillRect(x, 210 - h, w, h + 40)
    if (r() < 0.3) g.fillRect(x + w / 2 - 5, 200 - h, 10, 10), g.fillRect(x + w / 2 - 1, 210 - h, 2, 6)
    x += w + 2
  }
  g.fillRect(36, 92, 2, 70)
  g.fillStyle = '#ff5050'
  g.fillRect(35.5, 90, 3, 3)
  // near shopfronts with painted signs and lit windows
  const signs = [['SUYA SPOT', '#c0392b'], ['MAMA PUT', '#2e7d5b'], ['POS · TRANSFER', '#1f5fa8'], ['BARBING SALON', '#8e44ad'], ['PHONE REPAIRS', '#d35400']]
  let x = -4
  for (let i = 0; x < W; i++) {
    const w = 62 + r() * 26
    const h = 70 + r() * 30
    const top = FLOOR - 66 - h
    const wall = ['#8a6e5a', '#9c7c5e', '#7d6a7a', '#a08868'][i % 4]!
    const wg = g.createLinearGradient(x, 0, x + w, 0)
    wg.addColorStop(0, shade(wall, -0.35))
    wg.addColorStop(1, shade(wall, -0.1))
    g.fillStyle = wg
    g.fillRect(x, top, w, h + 40)
    fillTex(g, 'plaster', x, top, w, h + 40)
    g.fillStyle = 'rgba(40,20,40,0.45)'
    g.fillRect(x, top, w, h + 40)
    // zinc roof edge
    g.fillStyle = '#5d6166'
    g.fillRect(x - 3, top - 5, w + 6, 6)
    // windows
    for (let wy = top + 10; wy < FLOOR - 96; wy += 22) {
      for (let wx = x + 8; wx < x + w - 14; wx += 18) {
        const lit = r() < 0.55
        g.fillStyle = lit ? '#ffcf6b' : '#2a1f2e'
        g.fillRect(wx, wy, 9, 12)
        if (lit) (g.fillStyle = 'rgba(255,207,107,0.18)'), g.fillRect(wx - 3, wy - 3, 15, 18)
      }
    }
    // shop shutter + sign board
    g.fillStyle = '#3a3440'
    g.fillRect(x + 6, FLOOR - 72, w - 12, 30)
    g.fillStyle = 'rgba(255,255,255,0.08)'
    for (let k = FLOOR - 72; k < FLOOR - 42; k += 3) g.fillRect(x + 6, k, w - 12, 1)
    const [txt, col] = signs[i % signs.length]!
    g.fillStyle = col
    g.fillRect(x + 4, FLOOR - 86, w - 8, 12)
    g.fillStyle = '#fff'
    g.font = `800 7px system-ui, sans-serif`
    g.textAlign = 'center'
    g.fillText(txt, x + w / 2, FLOOR - 77.5, w - 12)
    x += w + 4
  }
  // power lines
  g.strokeStyle = 'rgba(20,10,20,0.6)'
  g.lineWidth = 0.8
  for (let k = 0; k < 3; k++) {
    g.beginPath()
    g.moveTo(0, 120 + k * 6)
    g.quadraticCurveTo(W / 2, 140 + k * 6, W, 118 + k * 6)
    g.stroke()
  }
  // street lights with glow
  for (const lx of [40, 248]) {
    g.fillStyle = '#2a2430'
    g.fillRect(lx - 1.5, FLOOR - 146, 3, 124)
    g.fillRect(lx - 1.5, FLOOR - 146, 16 * (lx < W / 2 ? 1 : -1), 3)
    const hx = lx + 14 * (lx < W / 2 ? 1 : -1)
    const lg = g.createRadialGradient(hx, FLOOR - 142, 1, hx, FLOOR - 142, 60)
    lg.addColorStop(0, 'rgba(255,230,160,0.8)')
    lg.addColorStop(1, 'rgba(255,200,120,0)')
    g.fillStyle = lg
    g.fillRect(hx - 60, FLOOR - 202, 120, 120)
  }
  // road: kerb, asphalt, lane paint, light pools
  const KERB = FLOOR - 26
  g.fillStyle = '#9a948a'
  g.fillRect(0, KERB - 4, W, 7)
  for (let k = 0; k < W; k += 16) (g.fillStyle = k % 32 ? '#f2f0ea' : '#1d1c1f'), g.fillRect(k, KERB - 4, 16, 3)
  fillTex(g, 'asphalt', 0, KERB + 3, W, H - KERB)
  const rg = g.createLinearGradient(0, KERB, 0, H)
  rg.addColorStop(0, 'rgba(255,170,110,0.2)')
  rg.addColorStop(1, 'rgba(0,0,0,0.4)')
  g.fillStyle = rg
  g.fillRect(0, KERB + 3, W, H - KERB)
  g.fillStyle = 'rgba(240,200,60,0.75)'
  for (let k = 6; k < W; k += 44) g.fillRect(k, FLOOR + 30, 24, 3)
  return cv
}

onMounted(() => {
  const g = hidpi(cv.value!, W, H)
  const FLOOR = 290
  // you fight as your own Sim
  const sim = lookFromSim(useSimStore().look)
  const ME: Partial<F> = { color: sim.top, skin: sim.skin, cap: '', hs: sim.hairStyle, bot: sim.bottom, sl: sim.sleeves, beard: sim.beard, fem: sim.female }
  const mk = (x: number, face: number, c: Partial<F>): F => ({ x, y: FLOOR, vy: 0, face, hp: 100, pow: 0, act: 'idle', t: 0, hitDone: false, name: 'You', ...ME, ...c }) as F
  const stageBg = paintStage(FLOOR)
  const r = rng(77)
  const CROWD = Array.from({ length: 16 }, (_, i) => ({
    x: 8 + i * 18 + r() * 6,
    h: r() * 8,
    top: ['#c0392b', '#2e7d5b', '#f1c40f', '#2f5fa8', '#e67e22', '#8e44ad', '#ecf0f1'][Math.floor(r() * 7)]!,
    skin: ['#4a2e1e', '#6e4630', '#8a5a3a', '#3a2216'][Math.floor(r() * 4)]!
  }))
  const sparks = new Particles()
  const prevHp = new Map<F, number>()
  let shakeT = 0
  const banner_title = (b: string) => (b.includes(' · ') ? b.split(' · ').pop()! : b)
  const banner_sub = (b: string) => (b.includes(' · ') ? b.split(' · ').slice(0, -1).join(' · ') : '')
  let stage = 0
  const on = props.online ?? null
  const PEER = { name: on?.peerName ?? 'Friend', color: '#1f3b5a', skin: '#4a2e1f', cap: '#e74c3c', hs: 'fade', bot: '#3a4a6e', sl: 'short' as const, level: 0 }
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
        const pick = (f: F) => ({ x: Math.round(f.x), y: Math.round(f.y), vy: f.vy, face: f.face, hp: f.hp, pow: Math.round(f.pow), act: f.act, t: f.t, color: f.color, skin: f.skin, cap: f.cap, hs: f.hs, bot: f.bot, sl: f.sl, beard: f.beard, fem: f.fem })
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

    // ---- draw: a Kaduna street at dusk (the backdrop is painted once)
    const shake = Math.max(0, shakeT) * 10
    shakeT -= dt
    g.save()
    if (shake > 0) g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)
    g.drawImage(stageBg, -6, -6, W + 12, H + 12)
    // the crowd at the kerb, bobbing and cheering
    const now = performance.now() / 1000
    for (let i = 0; i < CROWD.length; i++) {
      const c = CROWD[i]!
      const bob = Math.abs(Math.sin(now * (3 + (i % 3)) + i)) * (live ? 2.5 : 1)
      g.fillStyle = c.top
      rrect(g, c.x - 6, FLOOR - 56 - c.h - bob, 12, 26 + c.h, 4)
      g.fill()
      g.fillStyle = c.skin
      g.beginPath()
      g.arc(c.x, FLOOR - 62 - c.h - bob, 5, 0, Math.PI * 2)
      g.fill()
      if (i % 4 === 0) {
        g.strokeStyle = c.skin
        g.lineWidth = 3
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(c.x + 4, FLOOR - 54 - c.h - bob)
        g.lineTo(c.x + 7, FLOOR - 70 - c.h - bob - Math.sin(now * 8 + i) * 3)
        g.stroke()
      }
    }
    g.fillStyle = 'rgba(20,12,24,0.3)'
    g.fillRect(0, FLOOR - 76, W, 46)

    const lookOf = (f: F): Look => ({
      skin: f.skin,
      hair: '#141114',
      hairStyle: (f.hs as Look['hairStyle']) ?? 'fade',
      top: f.color,
      sleeves: f.sl ?? 'short',
      bottom: f.bot ?? '#2b3440',
      shoe: '#f2f0ea',
      cap: f.cap || undefined,
      beard: f.beard,
      female: f.fem
    })
    const poseOf = (f: F): Pose => {
      const k = DUR[f.act] ? f.t / DUR[f.act]! : 0
      if (f.act === 'ko') return POSE.ko()
      if (f.y < FLOOR - 1) return POSE.jump(f.vy)
      if (f.act === 'punch') return POSE.punch(k)
      if (f.act === 'kick') return POSE.kick(k)
      if (f.act === 'special') return POSE.special(f.t)
      if (f.act === 'block') return POSE.block()
      if (f.act === 'hurt') return POSE.hurt()
      if (f.act === 'walk') return POSE.walk(f.x * 0.12)
      return POSE.guard(now + (f === me ? 0 : 1.3))
    }
    const draw = (f: F) => {
      const air = FLOOR - f.y
      groundShadow(g, f.x, FLOOR + 2, Math.max(10, 22 - air * 0.12), 5, 0.45)
      if (f.act === 'ko') drawPerson(g, f.x - f.face * 4, FLOOR, 1.1, f.face, lookOf(f), poseOf(f), { rot: -1.45 })
      else {
        const p = poseOf(f)
        drawPerson(g, f.x, f.y, 1.1, f.face, lookOf(f), p)
      }
      // a hit lands: sparks + a little shake
      const prev = prevHp.get(f) ?? f.hp
      if (f.hp < prev) {
        const blocked = f.act === 'block'
        sparks.burst(f.x - f.face * 6, f.y - 54, blocked ? 6 : 14, blocked ? ['#cfe8ff', '#ffffff'] : ['#fff3b0', '#ffb83d', '#ff6a3d'], blocked ? 90 : 170, 0.35, 2.2, 200)
        if (!blocked) shakeT = Math.max(shakeT, prev - f.hp > 12 ? 0.25 : 0.12)
      }
      prevHp.set(f, f.hp)
    }
    // whoever is behind is drawn first
    if (me.act === 'punch' || me.act === 'kick') (draw(cpu), draw(me))
    else (draw(me), draw(cpu))
    // suya fireballs: a glowing core with a trail of embers
    for (const b of balls) {
      const dir = Math.sign(b.vx) || 1
      for (let k = 1; k <= 5; k++) {
        g.fillStyle = `rgba(255,${120 + k * 20},40,${0.35 - k * 0.06})`
        g.beginPath()
        g.arc(b.x - dir * k * 6, b.y + Math.sin(now * 30 + k) * 1.5, 9 - k, 0, Math.PI * 2)
        g.fill()
      }
      const fg = g.createRadialGradient(b.x, b.y, 1, b.x, b.y, 13)
      fg.addColorStop(0, '#fffbe0')
      fg.addColorStop(0.35, '#ffd34d')
      fg.addColorStop(0.7, '#ff7b00')
      fg.addColorStop(1, 'rgba(255,60,0,0)')
      g.fillStyle = fg
      g.beginPath()
      g.arc(b.x, b.y, 13, 0, Math.PI * 2)
      g.fill()
      if (Math.random() < 0.5) sparks.burst(b.x - dir * 8, b.y, 1, ['#ffb83d', '#ff6a3d'], 40, 0.3, 1.6, -40)
    }
    sparks.update(dt)
    sparks.draw(g)
    g.restore()
    vignette(g, W, H, 0.3)

    // ---- HUD: health + power, names, timer, round pips
    const bar = (x: number, f: F, flip: boolean) => {
      meter(g, x, 12, 112, 11, f.hp / 100, f.hp > 30 ? ['#7cf29a', '#1e9e4f'] : ['#ff8a7a', '#c0392b'], flip)
      meter(g, x + (flip ? 40 : 0), 27, 72, 5, f.pow / 100, f.pow >= 100 ? ['#fff3b0', '#ffb83d'] : ['#ffd34d', '#c9861a'], flip)
      hudText(g, f.name, flip ? x + 112 : x, 46, flip ? 'right' : 'left', 10)
      if (f.pow >= 100) hudText(g, '🔥', flip ? x + 30 : x + 82, 34, 'center', 10)
    }
    bar(8, me, false)
    bar(W - 120, cpu, true)
    g.fillStyle = 'rgba(10,12,20,0.75)'
    rrect(g, W / 2 - 17, 7, 34, 26, 8)
    g.fill()
    g.strokeStyle = 'rgba(255,211,77,0.6)'
    g.lineWidth = 1
    g.stroke()
    hudText(g, String(Math.max(0, Math.ceil(timer))), W / 2, 26, 'center', 16, timer < 10 ? '#ff8a7a' : '#fff')
    for (let i = 0; i < 2; i++) {
      for (const [side, wv] of [[-1, wins[0]!], [1, wins[1]!]] as const) {
        g.fillStyle = i < wv ? '#ffd34d' : 'rgba(255,255,255,0.25)'
        g.beginPath()
        g.arc(W / 2 + side * (8 + i * 9), 42, 3.2, 0, Math.PI * 2)
        g.fill()
      }
    }
    if (bannerT > 0) bannerCard(g, W, H, banner_title(banner), banner_sub(banner), 150)
  })
})
onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="cv" class="aspect-[288/352] w-full rounded-xl" />
</template>
