// Shared art for the phone arcade: a crisp high-DPI canvas, painted
// textures (asphalt, grass, laterite, concrete), shaded side-view people
// with a simple skeleton, top-down vehicles, particles and HUD panels.
// Everything is drawn in code, so it stays original and light to load.
import { rng } from './arcade'

type G = CanvasRenderingContext2D

/** Size a canvas for the screen's pixel density; draw in W x H units. */
export function hidpi(cv: HTMLCanvasElement, W: number, H: number): G {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.imageSmoothingEnabled = true
  return g
}

// ---------------------------------------------------------------- colour

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** lighten (amt > 0) or darken (amt < 0) a #rrggbb colour */
export function shade(c: string, amt: number): string {
  const [r, g, b] = hex(c)
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))
  return `rgb(${f(r)},${f(g)},${f(b)})`
}
export function alpha(c: string, a: number): string {
  const [r, g, b] = hex(c)
  return `rgba(${r},${g},${b},${a})`
}

// ---------------------------------------------------------------- shapes

export function rrect(g: G, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + k, y)
  g.arcTo(x + w, y, x + w, y + h, k)
  g.arcTo(x + w, y + h, x, y + h, k)
  g.arcTo(x, y + h, x, y, k)
  g.arcTo(x, y, x + w, y, k)
  g.closePath()
}

/** soft contact shadow on the ground */
export function groundShadow(g: G, x: number, y: number, rx: number, ry = rx * 0.28, a = 0.35) {
  const gr = g.createRadialGradient(x, y, 0, x, y, rx)
  gr.addColorStop(0, `rgba(0,0,0,${a})`)
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.save()
  g.translate(x, y)
  g.scale(1, ry / rx)
  g.translate(-x, -y)
  g.fillStyle = gr
  g.beginPath()
  g.arc(x, y, rx, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

export function vgrad(g: G, y0: number, y1: number, stops: Array<[number, string]>) {
  const gr = g.createLinearGradient(0, y0, 0, y1)
  for (const [t, c] of stops) gr.addColorStop(t, c)
  return gr
}

// ---------------------------------------------------------------- textures

const TEX = new Map<string, HTMLCanvasElement>()
function texCanvas(key: string, size: number, paint: (c: G, s: number, r: () => number) => void) {
  let cv = TEX.get(key)
  if (!cv) {
    cv = document.createElement('canvas')
    cv.width = cv.height = size
    paint(cv.getContext('2d')!, size, rng(key.length * 7919 + size))
    TEX.set(key, cv)
  }
  return cv
}
function speckle(c: G, s: number, r: () => number, base: string, n: number, spread: number, size = 1.6) {
  c.fillStyle = base
  c.fillRect(0, 0, s, s)
  for (let i = 0; i < n; i++) {
    const v = (r() - 0.5) * spread
    c.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`
    const k = size * (0.5 + r())
    c.fillRect(r() * s, r() * s, k, k)
  }
}
const PAINT: Record<string, (c: G, s: number, r: () => number) => void> = {
  asphalt: (c, s, r) => {
    speckle(c, s, r, '#45464c', 2600, 0.22, 1.4)
    for (let i = 0; i < 5; i++) {
      c.strokeStyle = 'rgba(20,20,24,0.35)'
      c.lineWidth = 0.8
      c.beginPath()
      let x = r() * s
      let y = r() * s
      c.moveTo(x, y)
      for (let k = 0; k < 4; k++) c.lineTo((x += (r() - 0.5) * 30), (y += (r() - 0.5) * 30))
      c.stroke()
    }
  },
  grass: (c, s, r) => {
    speckle(c, s, r, '#6f9e45', 1400, 0.18, 2)
    for (let i = 0; i < 900; i++) {
      const x = r() * s
      const y = r() * s
      c.strokeStyle = r() < 0.5 ? 'rgba(160,200,90,0.55)' : 'rgba(40,80,30,0.45)'
      c.lineWidth = 0.9
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4)
      c.stroke()
    }
  },
  laterite: (c, s, r) => {
    speckle(c, s, r, '#a8643a', 2200, 0.25, 1.8)
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(90,50,30,${0.2 + r() * 0.3})`
      c.beginPath()
      c.ellipse(r() * s, r() * s, 1 + r() * 2.5, 1 + r() * 1.5, r() * 3, 0, Math.PI * 2)
      c.fill()
    }
  },
  concrete: (c, s, r) => {
    speckle(c, s, r, '#b9b4aa', 1800, 0.16, 1.3)
    c.strokeStyle = 'rgba(0,0,0,0.12)'
    c.lineWidth = 1
    c.strokeRect(0.5, 0.5, s - 1, s - 1)
  },
  sand: (c, s, r) => speckle(c, s, r, '#d8c39a', 2000, 0.16, 1.2),
  plaster: (c, s, r) => speckle(c, s, r, '#d9cdb4', 1600, 0.12, 1.6),
  zinc: (c, s) => {
    c.fillStyle = '#8f969c'
    c.fillRect(0, 0, s, s)
    for (let x = 0; x < s; x += 4) {
      c.fillStyle = 'rgba(255,255,255,0.18)'
      c.fillRect(x, 0, 1.5, s)
      c.fillStyle = 'rgba(0,0,0,0.15)'
      c.fillRect(x + 2.5, 0, 1, s)
    }
    c.fillStyle = 'rgba(140,70,30,0.25)'
    c.fillRect(0, s * 0.7, s, s * 0.3)
  }
}
/** a repeating pattern, painted once at 2x and cached */
export function pattern(g: G, kind: keyof typeof PAINT, size = 128): CanvasPattern {
  const cv = texCanvas(kind, size * 2, PAINT[kind]!)
  const p = g.createPattern(cv, 'repeat')!
  p.setTransform(new DOMMatrix().scale(0.5))
  return p
}
/** fill a rect with a texture, offset so it can scroll */
export function fillTex(g: G, kind: keyof typeof PAINT, x: number, y: number, w: number, h: number, ox = 0, oy = 0) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.translate(ox % 128, oy % 128)
  g.fillStyle = pattern(g, kind)
  g.fillRect(x - 128, y - 128, w + 256, h + 256)
  g.restore()
}

// ---------------------------------------------------------------- people

export type Hair = 'lowcut' | 'fade' | 'afro' | 'puff' | 'cornrows' | 'braids' | 'locs' | 'bald'
export interface ArcadeLook {
  skin: string
  hair: string
  hairStyle: Hair
  top: string
  sleeves: 'short' | 'long' | 'none'
  bottom: string
  shorts?: boolean
  skirt?: boolean
  shoe: string
  cap?: string
  band?: string
  beard?: boolean
  female?: boolean
}
/** Angles are from straight down, + toward the way the person faces. */
export interface Pose {
  lean: number
  /** pelvis height above the feet; omit to stand the lower foot on the ground */
  hipY?: number
  armF: [number, number] // shoulder, elbow bend
  armB: [number, number]
  legF: [number, number] // hip, knee bend
  legB: [number, number]
  head?: number
  fist?: boolean
}

const UA = 13
const FA = 12
const TH = 18
const SH = 18
const TORSO = 25

const seg = (x: number, y: number, a: number, l: number): [number, number] => [x + Math.sin(a) * l, y + Math.cos(a) * l]
function limbStroke(g: G, pts: Array<[number, number]>, w: number, color: string) {
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(pts[0]![0], pts[0]![1])
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1])
  g.strokeStyle = 'rgba(0,0,0,0.38)'
  g.lineWidth = w + 1.6
  g.stroke()
  g.strokeStyle = color
  g.lineWidth = w
  g.stroke()
}

/** Leg end points (knee, foot) relative to the pelvis. */
function legPts(h: [number, number], px: number, py: number) {
  const knee = seg(px, py, h[0], TH)
  const foot = seg(knee[0], knee[1], h[0] - h[1], SH)
  return { knee, foot, shin: h[0] - h[1] }
}

export interface PersonOpts {
  /** whole-body rotation about the feet (KO, falls) */
  rot?: number
  /** a staff / stick held in the front hand */
  staff?: number
}

/**
 * A side-view person, feet at (x, y), `s` = scale (1 = ~80 px tall),
 * `face` = 1 facing right, -1 facing left.
 */
export function drawPerson(g: G, x: number, y: number, s: number, face: number, L: ArcadeLook, P: Pose, o: PersonOpts = {}) {
  g.save()
  g.translate(x, y)
  if (o.rot) g.rotate(o.rot * face)
  g.scale(face * s, s)
  // stand the lower foot on the ground
  let hipY = P.hipY
  if (hipY === undefined) {
    const a = legPts(P.legF, 0, 0).foot[1]
    const b = legPts(P.legB, 0, 0).foot[1]
    hipY = Math.max(a, b) + 2.4
  }
  const px = 0
  const py = -hipY
  const skin = L.skin
  const skinB = shade(skin, -0.22)
  const top = L.top
  const bottom = L.bottom

  const sh = seg(px, py, Math.PI - P.lean, TORSO) // shoulder
  const arm = (a: [number, number], back: boolean) => {
    const elbow = seg(sh[0], sh[1], a[0], UA)
    const hand = seg(elbow[0], elbow[1], a[0] + a[1], FA)
    const sk = back ? skinB : skin
    const tc = back ? shade(top, -0.2) : top
    if (L.sleeves === 'long') limbStroke(g, [sh, elbow, hand], 5.4, tc)
    else {
      limbStroke(g, [sh, elbow, hand], 4.8, sk)
      if (L.sleeves === 'short') limbStroke(g, [sh, seg(sh[0], sh[1], a[0], UA * 0.55)], 6.4, tc)
    }
    g.fillStyle = sk
    g.beginPath()
    g.arc(hand[0], hand[1], P.fist ? 3.1 : 2.6, 0, Math.PI * 2)
    g.fill()
    return { elbow, hand, ang: a[0] + a[1] }
  }
  const leg = (h: [number, number], back: boolean) => {
    const { knee, foot, shin } = legPts(h, px, py)
    const bc = back ? shade(bottom, -0.2) : bottom
    const sk = back ? skinB : skin
    if (L.shorts) {
      limbStroke(g, [[px, py], knee, foot], 5.2, sk)
      limbStroke(g, [[px, py], seg(px, py, h[0], TH * 0.8)], 7.2, bc)
    } else if (L.skirt) {
      limbStroke(g, [[px, py], knee, foot], 5.2, sk)
    } else limbStroke(g, [[px, py], knee, foot], 6.4, bc)
    // shoe: points forward, tilts a little with the shin
    g.save()
    g.translate(foot[0], foot[1])
    g.rotate(Math.max(-0.6, Math.min(0.6, -shin * 0.35)))
    g.fillStyle = back ? shade(L.shoe, -0.25) : L.shoe
    g.strokeStyle = 'rgba(0,0,0,0.45)'
    g.lineWidth = 0.9
    rrect(g, -3.2, -2.6, 10, 4.6, 2.2)
    g.fill()
    g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.55)'
    g.fillRect(-3, 1, 9.5, 0.9)
    g.restore()
  }

  // back limbs, torso, front limbs
  const back = arm(P.armB, true)
  leg(P.legB, true)
  leg(P.legF, false)

  g.save()
  g.translate(px, py)
  g.rotate(P.lean)
  // skirt over the hips
  if (L.skirt) {
    g.fillStyle = bottom
    g.beginPath()
    g.moveTo(-6, -3)
    g.lineTo(6.5, -3)
    g.lineTo(10, 14)
    g.lineTo(-9, 14)
    g.closePath()
    g.fill()
  }
  // torso
  const tg = g.createLinearGradient(-7, 0, 8, 0)
  tg.addColorStop(0, shade(top, -0.28))
  tg.addColorStop(0.55, top)
  tg.addColorStop(1, shade(top, 0.14))
  g.fillStyle = tg
  g.strokeStyle = 'rgba(0,0,0,0.4)'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(-5.5, 1.5)
  g.quadraticCurveTo(-7, -12, -6.4, -21)
  g.quadraticCurveTo(-5, -26.5, 0, -26.5)
  g.quadraticCurveTo(6, -26, 6.8, -21)
  if (L.female) g.quadraticCurveTo(9.2, -16.5, 6.2, -13)
  g.quadraticCurveTo(5.6, -6, 6, 1.5)
  g.closePath()
  g.fill()
  g.stroke()
  if (L.sleeves === 'none') {
    // tank top: skin at the shoulder
    g.fillStyle = skin
    g.beginPath()
    g.ellipse(0, -24.5, 3.4, 2.4, 0, 0, Math.PI * 2)
    g.fill()
  }
  // waistband
  if (!L.skirt) {
    g.fillStyle = bottom
    g.fillRect(-5.8, -2.5, 11.8, 4.5)
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.fillRect(-5.8, -2.5, 11.8, 1)
  }
  // neck + head
  g.fillStyle = skinB
  g.fillRect(-1.6, -30, 4.2, 5)
  g.translate(1, -36)
  g.rotate(P.head ?? 0)
  const hg = g.createRadialGradient(3, -3, 1, 0, 0, 9)
  hg.addColorStop(0, shade(skin, 0.18))
  hg.addColorStop(1, shade(skin, -0.15))
  g.fillStyle = hg
  g.strokeStyle = 'rgba(0,0,0,0.42)'
  g.lineWidth = 0.9
  g.beginPath()
  g.ellipse(0, 0, 6.3, 7.3, 0, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  // jaw + nose
  g.fillStyle = hg
  g.beginPath()
  g.ellipse(2.4, 3.6, 4, 3.4, 0.2, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.moveTo(5.9, -1.4)
  g.quadraticCurveTo(8.2, 1.4, 6, 2)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.28)'
  g.stroke()
  // ear
  g.fillStyle = skinB
  g.beginPath()
  g.ellipse(-1.3, 0.4, 1.5, 2.1, 0, 0, Math.PI * 2)
  g.fill()
  // eye + brow + mouth
  g.fillStyle = '#f5f1ea'
  g.beginPath()
  g.ellipse(3.9, -1.4, 1.5, 1.05, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#1a120d'
  g.beginPath()
  g.arc(4.5, -1.35, 0.85, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = shade(L.hair, -0.1)
  g.lineWidth = 0.9
  g.beginPath()
  g.moveTo(2.4, -3.4)
  g.lineTo(5.6, -3.2)
  g.stroke()
  g.strokeStyle = shade(skin, -0.45)
  g.lineWidth = 0.8
  g.beginPath()
  g.moveTo(3.6, 4.2)
  g.lineTo(5.6, 4)
  g.stroke()
  if (L.beard) {
    g.fillStyle = alpha(L.hair.startsWith('#') ? L.hair : '#141114', 0.85)
    g.beginPath()
    g.moveTo(-1, 1.5)
    g.quadraticCurveTo(1, 7.5, 5.6, 5.8)
    g.lineTo(5.6, 4.6)
    g.quadraticCurveTo(2, 5.6, 0.6, 1.2)
    g.closePath()
    g.fill()
  }
  // hair
  const hc = L.hair
  g.fillStyle = hc
  const cap = (h: number) => {
    g.beginPath()
    g.ellipse(-0.4, -1.6, 6.7, h, 0, Math.PI * 0.98, Math.PI * 2.08)
    g.quadraticCurveTo(3, -3.4, -2.6, -1.8)
    g.closePath()
    g.fill()
  }
  switch (L.hairStyle) {
    case 'bald':
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.beginPath()
      g.ellipse(1.5, -5, 2.4, 1.2, -0.3, 0, Math.PI * 2)
      g.fill()
      break
    case 'lowcut':
      g.globalAlpha = 0.85
      cap(6.6)
      g.globalAlpha = 1
      break
    case 'fade':
      cap(7.6)
      g.fillStyle = alpha(hc.startsWith('#') ? hc : '#141114', 0.4)
      g.fillRect(-6.4, -1.5, 4.5, 4)
      break
    case 'afro':
      g.beginPath()
      g.arc(-1, -4, 9, 0, Math.PI * 2)
      g.fill()
      break
    case 'puff':
      cap(7.4)
      g.beginPath()
      g.arc(-4.5, -8.5, 5.2, 0, Math.PI * 2)
      g.fill()
      break
    case 'cornrows':
      cap(7.6)
      g.strokeStyle = 'rgba(255,255,255,0.15)'
      g.lineWidth = 0.6
      for (let i = -4; i <= 4; i += 2) {
        g.beginPath()
        g.moveTo(i + 1, -7.4)
        g.quadraticCurveTo(i - 2, -3, -5.5, -1 + i * 0.3)
        g.stroke()
      }
      break
    case 'braids':
    case 'locs':
      cap(7.8)
      g.strokeStyle = hc
      g.lineWidth = L.hairStyle === 'locs' ? 2 : 1.4
      g.lineCap = 'round'
      for (let i = 0; i < 4; i++) {
        g.beginPath()
        g.moveTo(-5.5 + i * 1.2, -2)
        g.quadraticCurveTo(-8 + i, 6, -7 + i * 1.6, 13 - i)
        g.stroke()
      }
      break
  }
  if (L.cap) {
    g.fillStyle = L.cap
    g.beginPath()
    g.ellipse(-0.3, -3.2, 6.9, 5.2, 0, Math.PI, Math.PI * 2)
    g.fill()
    g.fillRect(3, -3.6, 7, 1.8)
    g.fillStyle = 'rgba(255,255,255,0.25)'
    g.fillRect(-4, -6.6, 5, 1.2)
  }
  if (L.band) {
    g.strokeStyle = L.band
    g.lineWidth = 1.8
    g.beginPath()
    g.ellipse(0, -3.3, 6.5, 1.6, 0, Math.PI * 0.95, Math.PI * 2.05)
    g.stroke()
  }
  g.restore()

  const front = arm(P.armF, false)
  if (o.staff) {
    // the staff runs through the front hand, along the forearm
    const a = front.ang
    const [hx, hy] = front.hand
    g.lineCap = 'round'
    g.strokeStyle = 'rgba(0,0,0,0.45)'
    g.lineWidth = 3.2
    g.beginPath()
    g.moveTo(hx - Math.sin(a) * 10, hy - Math.cos(a) * 10)
    g.lineTo(hx + Math.sin(a) * o.staff, hy + Math.cos(a) * o.staff)
    g.stroke()
    const sg = g.createLinearGradient(hx, hy, hx + Math.sin(a) * o.staff, hy + Math.cos(a) * o.staff)
    sg.addColorStop(0, '#7a5230')
    sg.addColorStop(1, '#c49a62')
    g.strokeStyle = sg
    g.lineWidth = 2.2
    g.stroke()
    g.fillStyle = skin
    g.beginPath()
    g.arc(hx, hy, 3, 0, Math.PI * 2)
    g.fill()
  }
  void back
  g.restore()
}

const sin = Math.sin
/** poses for the side-view people */
export const POSE = {
  idle: (t: number): Pose => ({ lean: 0.04, armF: [0.12 + sin(t * 2) * 0.03, 0.35], armB: [-0.12, 0.3], legF: [0.1, 0.02], legB: [-0.1, 0.02] }),
  guard: (t: number): Pose => {
    const b = sin(t * 5) * 0.04
    return { lean: 0.1, armF: [1 + b, 1.75], armB: [0.75 + b, 1.95], legF: [0.42, 0.32], legB: [-0.32, 0.18], fist: true }
  },
  walk: (ph: number): Pose => {
    const s = sin(ph)
    return { lean: 0.08, armF: [0.95 - s * 0.25, 1.6], armB: [0.7 + s * 0.25, 1.8], legF: [0.2 + s * 0.32, 0.2 + Math.max(0, -s) * 0.4], legB: [-0.2 - s * 0.32, 0.2 + Math.max(0, s) * 0.4], fist: true }
  },
  run: (ph: number): Pose => {
    const s = sin(ph)
    return {
      lean: 0.22,
      armF: [-s * 0.95, 1.5],
      armB: [s * 0.95, 1.5],
      legF: [s * 0.85 + 0.1, 0.35 + Math.max(0, -s) * 1.35],
      legB: [-s * 0.85 + 0.1, 0.35 + Math.max(0, s) * 1.35],
      fist: true
    }
  },
  jump: (vy: number): Pose => {
    const up = vy < 0
    return { lean: 0.12, hipY: 34, armF: up ? [2.5, 0.3] : [1.3, 0.6], armB: up ? [-0.6, 0.4] : [-0.9, 0.5], legF: [0.95, 1.6], legB: [0.25, 1.1], fist: true }
  },
  punch: (k: number): Pose => {
    const e = k < 0.45 ? k / 0.45 : Math.max(0, 1 - (k - 0.45) / 0.55)
    return { lean: 0.1 + e * 0.2, armF: [1 + e * 0.58, 1.75 * (1 - e)], armB: [0.75, 1.95], legF: [0.45 + e * 0.1, 0.3], legB: [-0.38 - e * 0.1, 0.15], fist: true }
  },
  kick: (k: number): Pose => {
    const e = k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 0.4) / 0.6)
    return { lean: 0.1 - e * 0.3, armF: [1 - e * 0.3, 1.7], armB: [0.6 - e * 0.9, 1.4], legF: [0.4 + e * 1.15, 1.3 * (1 - e) + 0.05], legB: [-0.12, 0.08], fist: true }
  },
  block: (): Pose => ({ lean: -0.04, armF: [1.85, 2.3], armB: [1.6, 2.45], legF: [0.36, 0.42], legB: [-0.36, 0.3], fist: true, head: -0.12 }),
  hurt: (): Pose => ({ lean: -0.3, armF: [-0.55, 0.5], armB: [-0.9, 0.4], legF: [0.32, 0.2], legB: [-0.25, 0.25], head: -0.35 }),
  special: (k: number): Pose => {
    const e = Math.min(1, k / 0.25)
    return { lean: 0.22 * e, armF: [1.3 + 0.27 * e, 0.6 * (1 - e)], armB: [1.2 + 0.3 * e, 0.8 * (1 - e)], legF: [0.55, 0.45], legB: [-0.45, 0.1] }
  },
  ko: (): Pose => ({ lean: 0, armF: [2.6, 0.2], armB: [2.9, 0.3], legF: [0.1, 0.1], legB: [-0.05, 0.05], head: 0.2 }),
  /** staff swing: k 0 (wound up overhead, behind) -> 1 (followed through low) */
  swing: (k: number): Pose => {
    const a = 2.9 - k * 2.6
    return { lean: 0.05 + k * 0.25, armF: [a, 0.25], armB: [a - 0.3, 0.6], legF: [0.42, 0.35], legB: [-0.38, 0.2], fist: true }
  },
  win: (t: number): Pose => ({ lean: 0, armF: [2.9 + sin(t * 8) * 0.15, 0.2], armB: [2.7 - sin(t * 8) * 0.15, 0.2], legF: [0.15, 0.02], legB: [-0.15, 0.02], fist: true })
}

/** turn the player's Sim look into an arcade look */
export function lookFromSim(l: any): ArcadeLook {
  const top = l?.topStyle as string | undefined
  const bot = l?.bottomStyle as string | undefined
  return {
    skin: l?.skin ?? '#6e4630',
    hair: l?.hairColor ?? '#141114',
    hairStyle: (l?.hair ?? 'lowcut') as Hair,
    top: l?.top ?? '#2f5fa8',
    sleeves: top === 'longsleeve' || top === 'shirt' ? 'long' : top === 'tank' ? 'none' : 'short',
    bottom: l?.bottom ?? '#3a4a6e',
    shorts: bot === 'shorts',
    skirt: bot === 'skirt',
    shoe: l?.shoeColor ?? '#f2f0ea',
    beard: l?.beard === 'full' || l?.beard === 'stubble',
    female: l?.body === 'woman'
  }
}

// ---------------------------------------------------------------- top-down vehicles

export interface CarOpts {
  roof?: string
  stripes?: string
  rack?: boolean
  brake?: boolean
}
/** a car or bus seen from above, front pointing up, centred at (x, y) */
export function drawCarTop(g: G, x: number, y: number, w: number, l: number, color: string, o: CarOpts = {}) {
  g.save()
  g.translate(x, y)
  // drop shadow
  g.fillStyle = 'rgba(0,0,0,0.32)'
  rrect(g, -w / 2 + 3, -l / 2 + 5, w, l, w * 0.28)
  g.fill()
  // wheels peeking out
  g.fillStyle = '#151517'
  for (const [wx, wy] of [[-1, -0.3], [1, -0.3], [-1, 0.3], [1, 0.3]] as const) rrect(g, wx * (w / 2) - 2.5, wy * l - 5, 5, 10, 1.5), g.fill()
  // body
  const bg = g.createLinearGradient(-w / 2, 0, w / 2, 0)
  bg.addColorStop(0, shade(color, -0.35))
  bg.addColorStop(0.3, color)
  bg.addColorStop(0.55, shade(color, 0.22))
  bg.addColorStop(1, shade(color, -0.35))
  g.fillStyle = bg
  g.strokeStyle = 'rgba(0,0,0,0.5)'
  g.lineWidth = 1
  rrect(g, -w / 2, -l / 2, w, l, w * 0.28)
  g.fill()
  g.stroke()
  if (o.stripes) {
    g.fillStyle = o.stripes
    g.fillRect(-w / 2, -l * 0.08, w, 3)
    g.fillRect(-w / 2, l * 0.08, w, 3)
  }
  // glass: windscreen, rear window
  const glass = (gy: number, gh: number, top: boolean) => {
    const gg = g.createLinearGradient(0, gy, 0, gy + gh)
    gg.addColorStop(0, top ? '#a8d4ec' : '#2c3e50')
    gg.addColorStop(1, top ? '#2c3e50' : '#7fb0cc')
    g.fillStyle = gg
    rrect(g, -w / 2 + 3, gy, w - 6, gh, 3)
    g.fill()
  }
  glass(-l / 2 + l * 0.17, l * 0.15, true)
  glass(l / 2 - l * 0.24, l * 0.1, false)
  // roof
  const rf = o.roof ?? shade(color, 0.08)
  g.fillStyle = rf
  rrect(g, -w / 2 + 3.5, -l / 2 + l * 0.33, w - 7, l * 0.4, 3)
  g.fill()
  if (o.rack) {
    g.strokeStyle = '#2b2b2b'
    g.lineWidth = 1
    for (let k = 0; k < 5; k++) {
      const ry = -l / 2 + l * 0.36 + k * (l * 0.34) / 4
      g.beginPath()
      g.moveTo(-w / 2 + 4, ry)
      g.lineTo(w / 2 - 4, ry)
      g.stroke()
    }
    g.fillStyle = '#6b4a2f'
    rrect(g, -w / 4, -l / 2 + l * 0.42, w / 2, l * 0.14, 2)
    g.fill()
  }
  g.fillStyle = 'rgba(255,255,255,0.22)'
  rrect(g, -w / 2 + 5, -l / 2 + l * 0.35, (w - 10) * 0.35, l * 0.36, 2)
  g.fill()
  // lights
  g.fillStyle = '#fff6c8'
  g.fillRect(-w / 2 + 2, -l / 2 + 1, 5, 2)
  g.fillRect(w / 2 - 7, -l / 2 + 1, 5, 2)
  g.fillStyle = o.brake ? '#ff2d2d' : '#9a1d1d'
  g.fillRect(-w / 2 + 2, l / 2 - 3, 5, 2)
  g.fillRect(w / 2 - 7, l / 2 - 3, 5, 2)
  if (o.brake) groundShadow(g, 0, l / 2 + 3, w * 0.7, 6, 0.0001)
  // mirrors
  g.fillStyle = shade(color, -0.3)
  g.fillRect(-w / 2 - 2.5, -l / 2 + l * 0.27, 3, 3)
  g.fillRect(w / 2 - 0.5, -l / 2 + l * 0.27, 3, 3)
  g.restore()
}

/** a keke (tricycle) from above */
export function drawKekeTop(g: G, x: number, y: number, color = '#2e8b57', canopy = '#f5c400') {
  g.save()
  g.translate(x, y)
  g.fillStyle = 'rgba(0,0,0,0.3)'
  rrect(g, -11, -14, 26, 36, 8)
  g.fill()
  g.fillStyle = '#151517'
  g.fillRect(-1.5, -19, 3, 7)
  g.fillRect(-14, 7, 4, 9)
  g.fillRect(10, 7, 4, 9)
  const bg = g.createLinearGradient(-13, 0, 13, 0)
  bg.addColorStop(0, shade(color, -0.3))
  bg.addColorStop(0.5, shade(color, 0.15))
  bg.addColorStop(1, shade(color, -0.3))
  g.fillStyle = bg
  g.beginPath()
  g.moveTo(-5, -17)
  g.lineTo(5, -17)
  g.lineTo(13, -4)
  g.lineTo(13, 17)
  g.lineTo(-13, 17)
  g.lineTo(-13, -4)
  g.closePath()
  g.fill()
  // canvas canopy
  const cg = g.createLinearGradient(-12, 0, 12, 0)
  cg.addColorStop(0, shade(canopy, -0.25))
  cg.addColorStop(0.5, shade(canopy, 0.2))
  cg.addColorStop(1, shade(canopy, -0.25))
  g.fillStyle = cg
  rrect(g, -12, -8, 24, 22, 4)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.25)'
  g.lineWidth = 0.8
  for (let k = -4; k <= 12; k += 4) {
    g.beginPath()
    g.moveTo(-12, k)
    g.lineTo(12, k)
    g.stroke()
  }
  g.restore()
}

/** an okada with its rider, from above */
export function drawOkadaTop(g: G, x: number, y: number, t: number, shirt = '#c0392b', helmet = '#f39c12', lean = 0) {
  g.save()
  g.translate(x, y)
  g.rotate(lean)
  g.fillStyle = 'rgba(0,0,0,0.3)'
  rrect(g, -5, -20, 12, 44, 6)
  g.fill()
  // tyres + body
  g.fillStyle = '#121214'
  rrect(g, -2.5, -23, 5, 11, 2)
  g.fill()
  rrect(g, -2.5, 11, 5, 12, 2)
  g.fill()
  g.fillStyle = '#7a1414'
  rrect(g, -4, -14, 8, 26, 3)
  g.fill()
  g.fillStyle = '#c9ccd1'
  g.fillRect(-10, -15, 20, 2)
  // rider: arms to the bars, shoulders, helmet
  g.strokeStyle = shade(shirt, -0.1)
  g.lineWidth = 3.4
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(-6, -2)
  g.lineTo(-9, -13)
  g.moveTo(6, -2)
  g.lineTo(9, -13)
  g.stroke()
  const sg = g.createRadialGradient(-2, -2, 1, 0, 0, 9)
  sg.addColorStop(0, shade(shirt, 0.25))
  sg.addColorStop(1, shade(shirt, -0.25))
  g.fillStyle = sg
  g.beginPath()
  g.ellipse(0, 0, 8.5, 5.5, 0, 0, Math.PI * 2)
  g.fill()
  const hg = g.createRadialGradient(-1.5, -2.5, 0.5, 0, -1, 5)
  hg.addColorStop(0, shade(helmet, 0.5))
  hg.addColorStop(1, shade(helmet, -0.2))
  g.fillStyle = hg
  g.beginPath()
  g.arc(0, -1.5, 4.6, 0, Math.PI * 2)
  g.fill()
  // exhaust puff
  g.fillStyle = `rgba(200,200,200,${0.25 + 0.15 * Math.sin(t * 20)})`
  g.beginPath()
  g.arc(4, 26 + (t * 40) % 6, 2.5, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

/** a tree canopy from above (with its shadow) */
export function drawTreeTop(g: G, x: number, y: number, r: number, hue = 0) {
  g.fillStyle = 'rgba(0,0,0,0.25)'
  g.beginPath()
  g.arc(x + r * 0.35, y + r * 0.45, r, 0, Math.PI * 2)
  g.fill()
  const base = hue ? '#5c8a2e' : '#3f7a34'
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26
    const cx = x + Math.cos(a) * r * 0.42
    const cy = y + Math.sin(a) * r * 0.42
    const gr = g.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 1, cx, cy, r * 0.65)
    gr.addColorStop(0, shade(base, 0.35))
    gr.addColorStop(1, shade(base, -0.25))
    g.fillStyle = gr
    g.beginPath()
    g.arc(cx, cy, r * 0.62, 0, Math.PI * 2)
    g.fill()
  }
}

// ---------------------------------------------------------------- props

/** a mango with a leaf; gold = the 5-point one */
export function drawMango(g: G, x: number, y: number, r: number, t: number, gold = false) {
  groundShadow(g, x + 1, y + r * 0.9, r * 1.1, r * 0.35, 0.35)
  g.save()
  g.translate(x, y)
  g.rotate(0.45)
  const mg = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.2)
  if (gold) {
    mg.addColorStop(0, '#fffbe0')
    mg.addColorStop(0.4, '#ffd700')
    mg.addColorStop(1, '#b8860b')
  } else {
    mg.addColorStop(0, '#ffe680')
    mg.addColorStop(0.45, '#f5a623')
    mg.addColorStop(0.8, '#e0602a')
    mg.addColorStop(1, '#7da33a')
  }
  g.fillStyle = mg
  g.beginPath()
  g.ellipse(0, 0, r * 0.82, r, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#2e6b2a'
  g.beginPath()
  g.ellipse(r * 0.35, -r * 1.05, r * 0.55, r * 0.22, -0.6, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.beginPath()
  g.ellipse(-r * 0.3, -r * 0.45, r * 0.18, r * 0.32, 0.3, 0, Math.PI * 2)
  g.fill()
  g.restore()
  if (gold) sparkle(g, x + r * 0.6, y - r * 0.7, 3 + Math.sin(t * 6) * 1.5)
}

export function sparkle(g: G, x: number, y: number, s: number) {
  g.fillStyle = 'rgba(255,255,240,0.95)'
  g.beginPath()
  g.moveTo(x, y - s)
  g.lineTo(x + s * 0.25, y - s * 0.25)
  g.lineTo(x + s, y)
  g.lineTo(x + s * 0.25, y + s * 0.25)
  g.lineTo(x, y + s)
  g.lineTo(x - s * 0.25, y + s * 0.25)
  g.lineTo(x - s, y)
  g.lineTo(x - s * 0.25, y - s * 0.25)
  g.closePath()
  g.fill()
}

/** a spinning gold coin */
export function drawCoin(g: G, x: number, y: number, r: number, t: number) {
  const w = Math.abs(Math.cos(t * 4 + x * 0.05))
  g.save()
  g.translate(x, y)
  g.scale(Math.max(0.15, w), 1)
  const cg = g.createRadialGradient(-r * 0.3, -r * 0.3, 0.5, 0, 0, r)
  cg.addColorStop(0, '#fff3b0')
  cg.addColorStop(0.5, '#f5c242')
  cg.addColorStop(1, '#a8740c')
  g.fillStyle = cg
  g.strokeStyle = '#8a5d08'
  g.lineWidth = 1
  g.beginPath()
  g.arc(0, 0, r, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.strokeStyle = 'rgba(138,93,8,0.7)'
  g.beginPath()
  g.arc(0, 0, r * 0.62, 0, Math.PI * 2)
  g.stroke()
  g.restore()
}

/** a red jerrycan */
export function drawJerrycan(g: G, x: number, y: number) {
  groundShadow(g, x + 2, y + 11, 11, 4)
  g.save()
  g.translate(x, y)
  const jg = g.createLinearGradient(-8, 0, 8, 0)
  jg.addColorStop(0, '#8e1b1b')
  jg.addColorStop(0.45, '#e53935')
  jg.addColorStop(1, '#8e1b1b')
  g.fillStyle = jg
  rrect(g, -8, -10, 16, 20, 2.5)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(-8, 0)
  g.lineTo(8, 0)
  g.moveTo(-6, -8)
  g.lineTo(6, 8)
  g.moveTo(6, -8)
  g.lineTo(-6, 8)
  g.stroke()
  g.fillStyle = '#f5c400'
  g.fillRect(3, -13, 4, 4)
  g.restore()
}

// ---------------------------------------------------------------- particles

interface Pt { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number }
export class Particles {
  list: Pt[] = []
  burst(x: number, y: number, n: number, color: string | string[], speed = 120, life = 0.5, size = 2.5, grav = 300) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = speed * (0.35 + Math.random() * 0.65)
      const c = Array.isArray(color) ? color[i % color.length]! : color
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life, max: life, size: size * (0.6 + Math.random() * 0.8), color: c, grav })
    }
  }
  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt
      p.vy += p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    this.list = this.list.filter((p) => p.life > 0)
  }
  draw(g: G) {
    for (const p of this.list) {
      g.globalAlpha = Math.max(0, p.life / p.max)
      g.fillStyle = p.color
      g.beginPath()
      g.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
  }
}

// ---------------------------------------------------------------- HUD

export function hudText(g: G, text: string, x: number, y: number, align: CanvasTextAlign = 'left', size = 13, color = '#fff') {
  g.font = `800 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`
  g.textAlign = align
  g.lineJoin = 'round'
  g.strokeStyle = 'rgba(0,0,0,0.55)'
  g.lineWidth = 3
  g.strokeText(text, x, y)
  g.fillStyle = color
  g.fillText(text, x, y)
}

/** a frosted pill behind HUD text */
export function hudPill(g: G, x: number, y: number, w: number, h: number) {
  g.fillStyle = 'rgba(10,12,20,0.5)'
  rrect(g, x, y, w, h, h / 2)
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.18)'
  g.lineWidth = 1
  g.stroke()
}

/** a meter with a bevel; v 0..1 */
export function meter(g: G, x: number, y: number, w: number, h: number, v: number, colors: [string, string], flip = false) {
  g.fillStyle = 'rgba(0,0,0,0.55)'
  rrect(g, x - 1, y - 1, w + 2, h + 2, h / 2 + 1)
  g.fill()
  const fw = Math.max(0, Math.min(1, v)) * w
  if (fw > 0.5) {
    const mg = g.createLinearGradient(0, y, 0, y + h)
    mg.addColorStop(0, colors[0])
    mg.addColorStop(1, colors[1])
    g.fillStyle = mg
    rrect(g, flip ? x + w - fw : x, y, fw, h, h / 2)
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.35)'
    rrect(g, flip ? x + w - fw + 1 : x + 1, y + 1, Math.max(0, fw - 2), h * 0.35, h / 4)
    g.fill()
  }
}

/** centred end / round banner on a dark glass card */
export function banner(g: G, W: number, H: number, title: string, sub = '', y = H / 2) {
  const w = Math.min(W - 24, Math.max(170, title.length * 11 + 40))
  const h = sub ? 64 : 46
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowBlur = 18
  const bg = g.createLinearGradient(0, y - h / 2, 0, y + h / 2)
  bg.addColorStop(0, 'rgba(30,30,48,0.92)')
  bg.addColorStop(1, 'rgba(12,12,22,0.92)')
  g.fillStyle = bg
  rrect(g, (W - w) / 2, y - h / 2, w, h, 16)
  g.fill()
  g.restore()
  g.strokeStyle = 'rgba(255,211,77,0.55)'
  g.lineWidth = 1.2
  rrect(g, (W - w) / 2, y - h / 2, w, h, 16)
  g.stroke()
  const tg = g.createLinearGradient(0, y - 14, 0, y + 6)
  tg.addColorStop(0, '#fff5c2')
  tg.addColorStop(1, '#ffb83d')
  g.font = `900 18px system-ui, -apple-system, 'Segoe UI', sans-serif`
  g.textAlign = 'center'
  g.fillStyle = tg
  g.fillText(title, W / 2, sub ? y - 3 : y + 6)
  if (sub) {
    g.font = `600 11px system-ui, -apple-system, 'Segoe UI', sans-serif`
    g.fillStyle = 'rgba(255,255,255,0.75)'
    g.fillText(sub, W / 2, y + 16)
  }
}

/** a soft vignette over the whole frame */
export function vignette(g: G, W: number, H: number, a = 0.35) {
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, `rgba(0,0,0,${a})`)
  g.fillStyle = vg
  g.fillRect(0, 0, W, H)
}
