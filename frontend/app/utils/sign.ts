// Runtime canvas-texture sign helper - zero extra dependencies.
// Generates crisp text signs for buildings (no font files needed).

import * as THREE from 'three'

const cache = new Map<string, THREE.CanvasTexture>()

export function makeSignTexture(
  text: string,
  opts: { bg?: string; fg?: string; sub?: string } = {}
): THREE.CanvasTexture {
  const key = `${text}|${opts.bg}|${opts.fg}|${opts.sub}`
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 160
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = opts.bg ?? '#123528'
  ctx.fillRect(0, 0, 512, 160)
  ctx.strokeStyle = opts.fg ?? '#E8B84B'
  ctx.lineWidth = 8
  ctx.strokeRect(6, 6, 500, 148)

  ctx.fillStyle = opts.fg ?? '#E8B84B'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const main = text.length > 18 ? 44 : text.length > 12 ? 52 : 64
  if (opts.sub) {
    ctx.font = `bold ${main}px system-ui, sans-serif`
    ctx.fillText(text, 256, 62)
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fillText(opts.sub, 256, 116)
  } else {
    ctx.font = `bold ${main}px system-ui, sans-serif`
    ctx.fillText(text, 256, 80)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(key, tex)
  return tex
}
