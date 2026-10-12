// Billboard ad artwork: brand, headline, tagline, call-to-action and a
// colour theme drawn onto a canvas at the billboard's 6.7 x 3.1 aspect.
// Used for the 3D screens, the billboard sheet previews and the editor.
import * as THREE from 'three'

export interface AdContent {
  brand: string
  headline: string
  subline?: string
  cta?: string
  domain?: string
  theme?: string
}
export const AD_THEMES: Record<string, { bg: string; bg2: string; fg: string; accent: string; ctaFg: string; label: string }> = {
  green: { bg: '#0f4a34', bg2: '#1f7a4d', fg: '#ffffff', accent: '#f2c14e', ctaFg: '#1b2a20', label: 'Forest' },
  night: { bg: '#141a33', bg2: '#2b3a7a', fg: '#ffffff', accent: '#7cc4ff', ctaFg: '#0d1530', label: 'Night' },
  sun: { bg: '#f2b12e', bg2: '#f7d36b', fg: '#2a1a05', accent: '#b23a1e', ctaFg: '#ffffff', label: 'Sun' },
  berry: { bg: '#5a1e4a', bg2: '#a83a6e', fg: '#ffffff', accent: '#ffd36b', ctaFg: '#3a0f2e', label: 'Berry' },
  sky: { bg: '#e8f3ff', bg2: '#bcdcff', fg: '#0d2440', accent: '#1f6fe0', ctaFg: '#ffffff', label: 'Sky' },
  clay: { bg: '#7c3a22', bg2: '#c4683c', fg: '#fff6ea', accent: '#f6e2b8', ctaFg: '#5a2412', label: 'Clay' }
}
export const AD_W = 1024
export const AD_H = 474

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur)
      cur = w
      if (lines.length === maxLines) break
    } else cur = t
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  return lines.slice(0, maxLines)
}

export function drawAd(c: HTMLCanvasElement, ad: AdContent): HTMLCanvasElement {
  c.width = AD_W
  c.height = AD_H
  const g = c.getContext('2d')!
  const t = AD_THEMES[ad.theme ?? 'green'] ?? AD_THEMES.green
  const grad = g.createLinearGradient(0, 0, AD_W, AD_H)
  grad.addColorStop(0, t.bg)
  grad.addColorStop(1, t.bg2)
  g.fillStyle = grad
  g.fillRect(0, 0, AD_W, AD_H)
  // soft shapes for depth
  g.globalAlpha = 0.12
  g.fillStyle = t.fg
  g.beginPath()
  g.arc(AD_W * 0.86, AD_H * 0.2, 210, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(AD_W * 0.95, AD_H * 0.95, 150, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 1

  const pad = 56
  // brand mark
  g.fillStyle = t.accent
  g.beginPath()
  g.arc(pad + 18, pad + 18, 18, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = t.fg
  g.font = '800 34px Nunito, system-ui, sans-serif'
  g.textBaseline = 'middle'
  g.fillText(ad.brand.slice(0, 32), pad + 48, pad + 19)

  // headline (auto-sized to fit 2-3 lines)
  let size = 78
  let lines: string[] = []
  for (; size >= 44; size -= 4) {
    g.font = `700 ${size}px Fredoka, Nunito, system-ui, sans-serif`
    lines = wrap(g, ad.headline, AD_W - pad * 2 - 40, 3)
    if (lines.join(' ').length >= ad.headline.length - 1 && lines.length * size * 1.05 < 230) break
  }
  g.fillStyle = t.fg
  g.textBaseline = 'alphabetic'
  let y = pad + 70 + size
  for (const l of lines) {
    g.fillText(l, pad, y)
    y += size * 1.04
  }
  if (ad.subline) {
    g.globalAlpha = 0.86
    g.font = '600 28px Nunito, system-ui, sans-serif'
    const sub = wrap(g, ad.subline, AD_W - pad * 2, 1)[0] ?? ''
    g.fillText(sub, pad, y + 8)
    g.globalAlpha = 1
  }
  // call to action pill + domain
  const by = AD_H - pad - 10
  if (ad.cta) {
    g.font = '800 28px Nunito, system-ui, sans-serif'
    const w = g.measureText(ad.cta + ' →').width + 48
    g.fillStyle = t.accent
    g.beginPath()
    g.roundRect(pad, by - 30, w, 56, 28)
    g.fill()
    g.fillStyle = t.ctaFg
    g.textBaseline = 'middle'
    g.fillText(ad.cta + ' →', pad + 24, by - 1)
  }
  if (ad.domain) {
    g.globalAlpha = 0.75
    g.fillStyle = t.fg
    g.font = '600 24px Nunito, system-ui, sans-serif'
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    g.fillText(ad.domain, AD_W - pad, by - 1)
    g.textAlign = 'left'
    g.globalAlpha = 1
  }
  return c
}

const texCache = new Map<string, THREE.CanvasTexture>()
export function adTexture(key: string, ad: AdContent): THREE.CanvasTexture {
  const hit = texCache.get(key)
  if (hit) return hit
  const tex = new THREE.CanvasTexture(drawAd(document.createElement('canvas'), ad))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  texCache.set(key, tex)
  return tex
}

/** house ads shown on empty boards: sell the slot, never a fake brand */
export function houseAds(priceSatsPerDay: number): AdContent[] {
  return [
    { brand: 'Kaduna Kulture', headline: 'Your ad here.', subline: `${priceSatsPerDay.toLocaleString()} sats a day · paid with Lightning`, cta: 'Tap the billboard', theme: 'green' },
    { brand: 'Kaduna Kulture', headline: 'Advertise to the whole city.', subline: 'Real ads, real links, every player drives past', cta: 'Book this board', theme: 'night' }
  ]
}
