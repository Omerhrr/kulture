// Surfaces - procedural, tileable ground textures (asphalt, grass, concrete,
// dirt, plaster) painted once on canvases, and a shader patch that maps them
// in WORLD space (x/z) onto the merged city buckets. Merged geometry has no
// UVs, so the texture is sampled from the fragment's world position: roads,
// pavements and fields get grain, wear, cracks and blades at any scale,
// with a second, larger sample mixed in to hide tiling.
import * as THREE from 'three'

type Painter = (ctx: CanvasRenderingContext2D, S: number, rnd: () => number) => void

function rng(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Value noise painted straight into pixels (tileable: wraps on S). */
function noiseLayer(ctx: CanvasRenderingContext2D, S: number, cell: number, amp: number, rnd: () => number, tint = [0, 0, 0]) {
  const n = Math.max(2, Math.round(S / cell))
  const g: number[] = []
  for (let i = 0; i < n * n; i++) g.push(rnd() * 2 - 1)
  const at = (i: number, j: number) => g[((j + n) % n) * n + ((i + n) % n)]
  const img = ctx.getImageData(0, 0, S, S)
  const d = img.data
  for (let y = 0; y < S; y++) {
    const fy = (y / S) * n
    const j = Math.floor(fy)
    const ty = fy - j
    const sy = ty * ty * (3 - 2 * ty)
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * n
      const i = Math.floor(fx)
      const tx = fx - i
      const sx = tx * tx * (3 - 2 * tx)
      const v =
        (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy
      const k = (y * S + x) * 4
      d[k] += v * amp + tint[0] * v
      d[k + 1] += v * amp + tint[1] * v
      d[k + 2] += v * amp + tint[2] * v
    }
  }
  ctx.putImageData(img, 0, 0)
}

function speckle(ctx: CanvasRenderingContext2D, S: number, n: number, rnd: () => number, cols: string[], rmax = 1.4) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cols[Math.floor(rnd() * cols.length)]
    const r = 0.4 + rnd() * rmax
    ctx.fillRect(rnd() * S, rnd() * S, r, r)
  }
}

const PAINT: Record<string, Painter> = {
  // greyish-neutral (multiplied by the bucket colour): aggregate grain,
  // patching, tyre polish and hairline cracks
  asphalt(ctx, S, rnd) {
    ctx.fillStyle = '#b8b8b8'
    ctx.fillRect(0, 0, S, S)
    noiseLayer(ctx, S, 64, 22, rnd)
    noiseLayer(ctx, S, 9, 10, rnd)
    speckle(ctx, S, S * S * 0.06, rnd, ['#d8d8d8', '#909090', '#a8a8a8', '#c8c4bc'])
    // tar patches
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(40,40,44,${0.08 + rnd() * 0.1})`
      ctx.beginPath()
      ctx.ellipse(rnd() * S, rnd() * S, 20 + rnd() * 60, 10 + rnd() * 30, rnd() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    // cracks
    ctx.strokeStyle = 'rgba(30,30,30,0.35)'
    for (let i = 0; i < 7; i++) {
      ctx.lineWidth = 0.6 + rnd()
      ctx.beginPath()
      let x = rnd() * S
      let y = rnd() * S
      ctx.moveTo(x, y)
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 30
        y += (rnd() - 0.5) * 30
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  },
  // savanna grass seen from above: blade strokes in mixed greens and straw
  grass(ctx, S, rnd) {
    ctx.fillStyle = '#c4c4b4'
    ctx.fillRect(0, 0, S, S)
    noiseLayer(ctx, S, 48, 26, rnd, [10, 18, -6])
    for (let i = 0; i < S * S * 0.05; i++) {
      const x = rnd() * S
      const y = rnd() * S
      const l = 2 + rnd() * 6
      const a = rnd() * Math.PI * 2
      const v = 150 + rnd() * 100
      ctx.strokeStyle = rnd() < 0.25 ? `rgba(${v + 20},${v + 10},${v * 0.6},0.6)` : `rgba(${v * 0.7},${v},${v * 0.55},0.55)`
      ctx.lineWidth = 0.7
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
    noiseLayer(ctx, S, 7, 9, rnd)
  },
  // poured concrete slabs: joints every quarter tile, stains, fine grain
  concrete(ctx, S, rnd) {
    ctx.fillStyle = '#d4d4d0'
    ctx.fillRect(0, 0, S, S)
    noiseLayer(ctx, S, 80, 14, rnd)
    noiseLayer(ctx, S, 6, 8, rnd)
    speckle(ctx, S, S * S * 0.02, rnd, ['#b8b8b4', '#e4e4e0'])
    ctx.strokeStyle = 'rgba(70,70,66,0.45)'
    ctx.lineWidth = 1.5
    for (let k = 0; k <= 4; k++) {
      const p = (k * S) / 4
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, S)
      ctx.moveTo(0, p)
      ctx.lineTo(S, p)
      ctx.stroke()
    }
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(90,80,60,${0.05 + rnd() * 0.07})`
      ctx.beginPath()
      ctx.ellipse(rnd() * S, rnd() * S, 10 + rnd() * 40, 8 + rnd() * 30, rnd() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  // laterite dirt: red-brown grains and pebbles
  dirt(ctx, S, rnd) {
    ctx.fillStyle = '#c8bfb0'
    ctx.fillRect(0, 0, S, S)
    noiseLayer(ctx, S, 40, 24, rnd, [8, 0, -8])
    speckle(ctx, S, S * S * 0.05, rnd, ['#a89880', '#e0d4c0', '#8a7a64'], 2.2)
    noiseLayer(ctx, S, 6, 10, rnd)
  },
  // rendered plaster walls: soft blotches and rain streaks
  plaster(ctx, S, rnd) {
    ctx.fillStyle = '#d8d8d8'
    ctx.fillRect(0, 0, S, S)
    noiseLayer(ctx, S, 70, 16, rnd)
    noiseLayer(ctx, S, 5, 6, rnd)
    for (let i = 0; i < 14; i++) {
      const x = rnd() * S
      const g = ctx.createLinearGradient(x, 0, x, S * (0.2 + rnd() * 0.5))
      g.addColorStop(0, 'rgba(60,55,50,0.10)')
      g.addColorStop(1, 'rgba(60,55,50,0)')
      ctx.fillStyle = g
      ctx.fillRect(x, 0, 2 + rnd() * 6, S)
    }
  }
}

const cache: Record<string, THREE.Texture> = {}
export function surfaceTexture(kind: keyof typeof PAINT, size = 512): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  if (cache[kind]) return cache[kind]
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  PAINT[kind](ctx, size, rng(kind.length * 977 + 13))
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.generateMipmaps = true
  cache[kind] = t
  return t
}

/**
 * Patch a Lambert/Standard material so it multiplies a world-space texture
 * into the diffuse colour. `scale` = metres per tile. `vertical` maps walls
 * (xy / zy picked by the normal) instead of the ground plane. The texture's
 * mean is ~0.75 grey so it is renormalised to keep the bucket colour honest.
 */
export function worldTexture(
  mat: THREE.Material,
  kind: keyof typeof PAINT,
  scale: number,
  opts: { strength?: number; vertical?: boolean; chain?: (shader: any) => void } = {}
) {
  const tex = surfaceTexture(kind)
  if (!tex) return
  const strength = opts.strength ?? 1
  const prev = (mat as any).onBeforeCompile
  ;(mat as any).onBeforeCompile = (shader: any, r: any) => {
    if (typeof prev === 'function') prev(shader, r)
    shader.uniforms.uSurf = { value: tex }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWNrm = normalize(mat3(modelMatrix) * objectNormal);`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSurf;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    vec2 suv = vWPos.xz;
    ${opts.vertical ? 'vec3 an = abs(vWNrm); if (an.y < 0.6) suv = an.x > an.z ? vWPos.zy : vWPos.xy;' : ''}
    vec3 s1 = texture2D(uSurf, suv / ${scale.toFixed(2)}).rgb;
    vec3 s2 = texture2D(uSurf, suv / ${(scale * 7.3).toFixed(2)} + 0.37).rgb;
    vec3 st = (s1 * 0.7 + s2 * 0.3) / 0.75;
    // distance fade: far away the texture averages out (no moire)
    float fd = clamp(length(vWPos - cameraPosition) / ${(scale * 90).toFixed(1)}, 0.0, 1.0);
    diffuseColor.rgb *= mix(vec3(1.0), mix(st, vec3(1.0), fd * 0.6), ${strength.toFixed(2)});
  }`
      )
    opts.chain?.(shader)
  }
  const key = (mat as any).customProgramCacheKey?.call(mat) ?? ''
  ;(mat as any).customProgramCacheKey = () => `${key}|surf-${kind}-${scale}-${strength}-${!!opts.vertical}`
  mat.needsUpdate = true
}
