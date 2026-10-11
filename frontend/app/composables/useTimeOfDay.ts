// Time of day state. One full day runs in about 8 real minutes by default
// (configurable); DayNight.vue advances the clock, drives the sky, the sun,
// the stars and every night light from these numbers. Press N in game to
// jump two hours for a quick look at the night city.

export interface SunState {
  /** sun elevation above horizon, -PI/2..PI/2 (negative = night) */
  elev: number
  /** 0 = midnight, 1 = noon daylight factor, eased */
  daylight: number
  /** 0..1, 1 = deep night */
  night: number
  /** warm dusk factor (peaks when the sun grazes the horizon) */
  dusk: number
  /** sun world direction (from origin toward the sun) */
  sx: number
  sy: number
  sz: number
}

export function useClock() {
  return useState<number>('kk_hour', () => 8.4)
}

export function useClockSpeed() {
  // real seconds per in game day
  return useState<number>('kk_day_seconds', () => 480)
}

export function formatHour(hour: number): string {
  const h = Math.floor(((hour % 24) + 24) % 24)
  const m = Math.floor((hour - Math.floor(hour)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Sky / fog / light parameters for a given hour. */
export function sunState(hour: number): SunState {
  const h = ((hour % 24) + 24) % 24
  // sun rises at 6, sets at 18: elevation follows a half sine
  const dayT = (h - 6) / 12 // 0 at sunrise, 1 at sunset
  const elev = Math.sin(dayT * Math.PI) * (Math.PI * 0.42) // noon ~75 deg
  const azimuth = (h / 24) * Math.PI * 2 - Math.PI / 2 // east at 6, west at 18
  const cosE = Math.cos(elev)
  const sx = Math.cos(azimuth) * cosE
  const sy = Math.sin(elev)
  const sz = Math.sin(azimuth) * cosE * 0.55 + 0.2
  // daylight: clamped elevation with a smooth shoulder through dawn/dusk
  const raw = Math.max(0, Math.min(1, sy / 0.42))
  const daylight = raw * raw * (3 - 2 * raw) // smoothstep
  const night = 1 - daylight
  // dusk glow peaks when the sun is near the horizon (sy in 0..0.22)
  const duskRaw = Math.max(0, 1 - Math.abs(sy - 0.1) / 0.16)
  const dusk = duskRaw * (h > 4 && h < 20 ? 1 : 0)
  return { elev, daylight, night, dusk, sx, sy, sz }
}

/** Palette shared by the sky, the fog and every tinted light. */
export function skyPalette(s: SunState): { sky: string; fog: string; sun: string; ambient: string } {
  if (s.night > 0.82) {
    return { sky: '#16223d', fog: '#182848', sun: '#8fa8d8', ambient: '#7e8fb8' }
  }
  if (s.dusk > 0.05) {
    // blend day -> dusk -> night
    const sky = mixHex('#9ec7de', '#e08a52', Math.min(1, s.dusk * 1.35))
    const fog = mixHex('#b8d2e0', '#d88a58', Math.min(1, s.dusk * 1.35))
    const sun = mixHex('#fff2d8', '#ff9a4d', Math.min(1, s.dusk * 1.6))
    const ambient = mixHex('#fff4e0', '#e0a878', Math.min(1, s.dusk * 1.4))
    if (s.night > 0.55) {
      const k = (s.night - 0.55) / 0.45
      return {
        sky: mixHex(sky, '#16223d', k),
        fog: mixHex(fog, '#182848', k),
        sun: mixHex(sun, '#8fa8d8', k),
        ambient: mixHex(ambient, '#7e8fb8', k)
      }
    }
    return { sky, fog, sun, ambient }
  }
  return { sky: '#9ec7de', fog: '#b8d2e0', sun: '#fff2d8', ambient: '#fff4e0' }
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ar = (pa >> 16) & 255
  const ag = (pa >> 8) & 255
  const ab = pa & 255
  const br = (pb >> 16) & 255
  const bg = (pb >> 8) & 255
  const bb = pb & 255
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}
