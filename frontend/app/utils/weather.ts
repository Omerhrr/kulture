// Weather state machine shared by the sky, lights, particles, foliage,
// pedestrians and audio. Plain module state (read every frame, no Vue
// reactivity cost); the HUD mirrors the label through useState.
//
// Kinds follow Kaduna's real year: hot sunny days, puffy cloudy spells,
// tropical rain, rare thunderstorms, and the harmattan (dry dusty haze off
// the Sahara from late October to February).

export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'harmattan'

export interface WeatherParams {
  /** 0..1 sky cover */
  cloud: number
  /** 0..1 rain intensity */
  rain: number
  /** 0..1 wind strength (0.2 = gentle breeze) */
  wind: number
  /** 0..1 harmattan dust haze */
  haze: number
  /** 0..1 thunderstorm (lightning) */
  storm: number
}

const PRESETS: Record<WeatherKind, WeatherParams> = {
  sunny: { cloud: 0.08, rain: 0, wind: 0.22, haze: 0, storm: 0 },
  cloudy: { cloud: 0.68, rain: 0, wind: 0.45, haze: 0, storm: 0 },
  rain: { cloud: 0.88, rain: 0.65, wind: 0.55, haze: 0, storm: 0 },
  storm: { cloud: 1, rain: 1, wind: 1, haze: 0, storm: 1 },
  harmattan: { cloud: 0.15, rain: 0, wind: 0.5, haze: 1, storm: 0 }
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  sunny: '☀️ Sunny',
  cloudy: '⛅ Cloudy',
  rain: '🌧️ Rain',
  storm: '⛈️ Storm',
  harmattan: '🌫️ Harmattan'
}

// AUTO mode never cycles "seasons": the city stays sunny and only a short
// rain shower rolls through now and then (see pickAuto / stepWeather). The
// full set (cloudy, storm, harmattan) remains available through the manual
// demo cycle (Y / the weather chip).

/** Auto-weather: sunny stretches with rare, brief showers. No seasons. */
function pickAuto(k: WeatherKind): WeatherKind {
  if (k === 'sunny') return Math.random() < 0.55 ? 'rain' : 'cloudy'
  return 'sunny'
}
/** How long a kind lasts on its own (seconds) before the auto switch. */
function autoDwell(k: WeatherKind): number {
  switch (k) {
    case 'sunny': return 300 + Math.random() * 300 // 5-10 min of clear sky
    case 'cloudy': return 45 + Math.random() * 45 // passing shade
    case 'rain': return 35 + Math.random() * 45 // a quick shower
    case 'storm': return 45 + Math.random() * 40
    default: return 90 + Math.random() * 90
  }
}

export const weather = {
  kind: 'sunny' as WeatherKind,
  /** smoothed current values */
  cur: { ...PRESETS.sunny } as WeatherParams,
  /** seconds until the next change */
  timer: 120,
  /** shared shader uniforms (foliage sway) */
  uniforms: { uTime: { value: 0 }, uWind: { value: 0.22 } },
  /** 0..1 lightning flash, decays fast */
  flash: 0,
  listeners: new Set<(k: WeatherKind) => void>()
}

export function setWeather(kind: WeatherKind, snap = false) {
  weather.kind = kind
  if (snap) Object.assign(weather.cur, PRESETS[kind])
  weather.timer = autoDwell(kind)
  for (const l of weather.listeners) l(kind)
}

export function cycleWeather() {
  const order: WeatherKind[] = ['sunny', 'cloudy', 'rain', 'storm', 'harmattan']
  setWeather(order[(order.indexOf(weather.kind) + 1) % order.length])
}

function pickNext(k: WeatherKind): WeatherKind {
  const opts = NEXT[k]
  let total = 0
  for (const [, w] of opts) total += w
  let r = Math.random() * total
  for (const [n, w] of opts) {
    r -= w
    if (r <= 0) return n
  }
  return opts[0][0]
}

let thunderCb: ((delay: number, strength: number) => void) | null = null
export function onThunder(cb: (delay: number, strength: number) => void) {
  thunderCb = cb
}

let flashTimer = 6
/** Advance the weather (call once per frame). */
export function stepWeather(dt: number, elapsed: number) {
  weather.timer -= dt
  if (weather.timer <= 0) setWeather(pickAuto(weather.kind))
  const target = PRESETS[weather.kind]
  // quick transitions: showers roll in and clear fast
  const k = 1 - Math.exp(-dt / 3.5)
  const kr = 1 - Math.exp(-dt / 5)
  const c = weather.cur
  c.cloud += (target.cloud - c.cloud) * k
  c.rain += (target.rain - c.rain) * kr
  c.haze += (target.haze - c.haze) * k
  c.storm += (target.storm - c.storm) * k
  // wind gusts on top of the base strength
  const gust = (Math.sin(elapsed * 0.37) * 0.5 + Math.sin(elapsed * 1.13 + 1.7) * 0.3) * 0.18
  c.wind += (target.wind + gust * (0.5 + target.wind) - c.wind) * (1 - Math.exp(-dt / 2))
  c.wind = Math.max(0.05, c.wind)
  weather.uniforms.uTime.value = elapsed
  weather.uniforms.uWind.value = c.wind
  // lightning
  weather.flash = Math.max(0, weather.flash - dt * 6)
  if (c.storm > 0.5) {
    flashTimer -= dt
    if (flashTimer <= 0) {
      flashTimer = 4 + Math.random() * 9
      weather.flash = 1
      thunderCb?.(0.4 + Math.random() * 2.2, 0.6 + Math.random() * 0.4)
    }
  }
}

/**
 * Patch a material so geometry sways in the wind. Merged world-space
 * geometry is assumed (position = world position), so gusts roll through
 * the city as a wave. Amplitude grows with height above `base`.
 */
export function addWindSway(mat: { onBeforeCompile: unknown; customProgramCacheKey: unknown }, strength = 1, base = 1.4) {
  const m = mat as unknown as THREE_MaterialLike
  m.onBeforeCompile = (shader: any) => {
    shader.uniforms.uTime = weather.uniforms.uTime
    shader.uniforms.uWind = weather.uniforms.uWind
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  float swayH = max(position.y - ${base.toFixed(2)}, 0.0);
  float swayK = swayH * ${(0.05 * strength).toFixed(3)} * (0.25 + uWind * 1.6);
  float ph = uTime * (1.2 + uWind * 1.8) + position.x * 0.045 + position.z * 0.06;
  transformed.x += sin(ph) * swayK + uWind * swayK * 0.8;
  transformed.z += cos(ph * 0.83 + 1.3) * swayK * 0.6;`
      )
  }
  m.customProgramCacheKey = () => `kk-wind-${strength}-${base}`
}
interface THREE_MaterialLike {
  onBeforeCompile: (shader: any) => void
  customProgramCacheKey: () => string
}
