// Procedural city audio (WebAudio, zero assets). A tiny DSP city: wind and
// traffic hum from filtered noise, birds and crickets from scheduled
// oscillator blips, market chatter from bandpassed noise bursts, footsteps
// from shaped clicks, engines from a sawtooth pair, plus one shot horns and
// UI chimes. Init needs a user gesture (autoplay policy); everything is
// best effort and fails silent.

import { WORLD_SCALE } from './kaduna'

type Zones = {
  /** 0..1 how close the market is */
  market: number
  /** 0..1 how close open water is */
  water: number
  /** 0..1 night factor */
  night: number
  /** 0..1 proximity to the railway */
  rail: number
}

class KKAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private ambBus: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineOsc2: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private windGain: GainNode | null = null
  private chatterGain: GainNode | null = null
  private waterGain: GainNode | null = null
  private humGain: GainNode | null = null
  private rainGain: GainNode | null = null
  private weatherWind = 0.22
  private started = false
  private muted = false
  private night = 0
  private birdTimer = 3
  private cricketTimer = 2
  private chatterTimer = 1
  private trainTimer = 20

  get ready() {
    return this.started && !!this.ctx
  }

  get isMuted() {
    return this.muted
  }

  init() {
    if (this.started) {
      void this.ctx?.resume()
      return
    }
    if (typeof window === 'undefined') return
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    try {
      this.ctx = new AC()
      const ctx = this.ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.55
      this.master.connect(ctx.destination)
      this.ambBus = ctx.createGain()
      this.ambBus.gain.value = 1
      this.ambBus.connect(this.master)

      // ---- wind / city hum: looping noise through a lowpass
      const noiseBuf = this.noiseBuffer(2.4)
      const wind = ctx.createBufferSource()
      wind.buffer = noiseBuf
      wind.loop = true
      const windLp = ctx.createBiquadFilter()
      windLp.type = 'lowpass'
      windLp.frequency.value = 420
      this.windGain = ctx.createGain()
      this.windGain.gain.value = 0.05
      wind.connect(windLp).connect(this.windGain).connect(this.ambBus)
      wind.start()

      const hum = ctx.createBufferSource()
      hum.buffer = noiseBuf
      hum.loop = true
      const humLp = ctx.createBiquadFilter()
      humLp.type = 'lowpass'
      humLp.frequency.value = 130
      this.humGain = ctx.createGain()
      this.humGain.gain.value = 0.03
      hum.connect(humLp).connect(this.humGain).connect(this.ambBus)
      hum.start()

      // ---- market chatter: bandpassed noise + wobble
      const chat = ctx.createBufferSource()
      chat.buffer = noiseBuf
      chat.loop = true
      const chatBp = ctx.createBiquadFilter()
      chatBp.type = 'bandpass'
      chatBp.frequency.value = 900
      chatBp.Q.value = 0.6
      this.chatterGain = ctx.createGain()
      this.chatterGain.gain.value = 0
      chat.connect(chatBp).connect(this.chatterGain).connect(this.ambBus)
      chat.start()

      // ---- river / water: hissy bandpass noise
      const water = ctx.createBufferSource()
      water.buffer = noiseBuf
      water.loop = true
      const waterBp = ctx.createBiquadFilter()
      waterBp.type = 'bandpass'
      waterBp.frequency.value = 2400
      waterBp.Q.value = 0.4
      this.waterGain = ctx.createGain()
      this.waterGain.gain.value = 0
      water.connect(waterBp).connect(this.waterGain).connect(this.ambBus)
      water.start()

      // ---- rain: bright hiss + low patter
      const rainSrc = ctx.createBufferSource()
      rainSrc.buffer = noiseBuf
      rainSrc.loop = true
      const rainHp = ctx.createBiquadFilter()
      rainHp.type = 'highpass'
      rainHp.frequency.value = 1400
      this.rainGain = ctx.createGain()
      this.rainGain.gain.value = 0
      rainSrc.connect(rainHp).connect(this.rainGain).connect(this.ambBus)
      rainSrc.start()

      // ---- engine: detuned saw pair through a lowpass
      this.engineFilter = ctx.createBiquadFilter()
      this.engineFilter.type = 'lowpass'
      this.engineFilter.frequency.value = 320
      this.engineGain = ctx.createGain()
      this.engineGain.gain.value = 0
      this.engineOsc = ctx.createOscillator()
      this.engineOsc.type = 'sawtooth'
      this.engineOsc.frequency.value = 55
      this.engineOsc2 = ctx.createOscillator()
      this.engineOsc2.type = 'square'
      this.engineOsc2.frequency.value = 27
      this.engineOsc.connect(this.engineFilter)
      this.engineOsc2.connect(this.engineFilter)
      this.engineFilter.connect(this.engineGain).connect(this.master)
      this.engineOsc.start()
      this.engineOsc2.start()

      this.started = true
    } catch {
      this.started = false
    }
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    return buf
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05)
    }
    try {
      localStorage.setItem('kk_muted', m ? '1' : '0')
    } catch {
      /* private mode */
    }
  }

  restoreMute() {
    try {
      this.muted = localStorage.getItem('kk_muted') === '1'
    } catch {
      this.muted = false
    }
    return this.muted
  }

  /** Per frame zone update (call a few times per second, not every frame). */
  update(dt: number, moving: boolean, zones: Zones) {
    if (!this.ready || !this.ctx) return
    const t = this.ctx.currentTime
    this.night = zones.night
    this.windGain?.gain.setTargetAtTime(0.02 + zones.night * 0.015 + this.weatherWind * 0.11, t, 0.6)
    this.humGain?.gain.setTargetAtTime(0.028 * (1 - zones.night * 0.55), t, 0.4)
    this.chatterGain?.gain.setTargetAtTime(zones.market * (0.09 + Math.random() * 0.02), t, 0.5)
    this.waterGain?.gain.setTargetAtTime(zones.water * 0.12, t, 0.5)

    // scheduled life: birds by day, crickets by night, train horn far away
    this.birdTimer -= dt
    if (this.birdTimer <= 0) {
      this.birdTimer = 2.4 + Math.random() * 5.5
      if (zones.night < 0.35) this.chirp()
    }
    this.cricketTimer -= dt
    if (this.cricketTimer <= 0) {
      this.cricketTimer = 1.1 + Math.random() * 1.6
      if (zones.night > 0.55) this.cricket()
    }
    this.chatterTimer -= dt
    if (this.chatterTimer <= 0) {
      this.chatterTimer = 1.6 + Math.random() * 3.4
      if (zones.market > 0.35) this.voiceBlip(zones.market)
    }
    this.trainTimer -= dt
    if (this.trainTimer <= 0) {
      this.trainTimer = 26 + Math.random() * 30
      if (zones.rail > 0.25 && zones.night > 0.3) this.trainHorn(zones.rail)
    }
    void moving
  }

  /** Weather bed: rain hiss and wind follow utils/weather. */
  setWeather(rain: number, wind: number, _storm: number) {
    this.weatherWind = wind
    if (!this.ready || !this.ctx) return
    this.rainGain?.gain.setTargetAtTime(rain * 0.16, this.ctx.currentTime, 0.8)
  }

  /** Rolling thunder: low filtered noise burst with a long tail. */
  thunder(strength = 1) {
    if (!this.ready || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(3.5)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(380, t)
    lp.frequency.exponentialRampToValueAtTime(70, t + 3.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.55 * strength, t + 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4)
    src.connect(lp).connect(g).connect(this.master)
    src.start(t)
  }

  /** Physical impact: a short thud (body, crash) scaled by strength. */
  impact(strength = 1) {
    if (!this.ready || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(0.4)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 260 + strength * 600
    const g = ctx.createGain()
    g.gain.setValueAtTime(Math.min(0.9, 0.25 + strength * 0.5), t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    src.connect(lp).connect(g).connect(this.master)
    src.start(t)
    // metallic crunch for hard hits
    if (strength > 0.55) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(140, t)
      o.frequency.exponentialRampToValueAtTime(48, t + 0.25)
      const og = ctx.createGain()
      og.gain.setValueAtTime(0.12 * strength, t)
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
      o.connect(og).connect(this.master)
      o.start(t)
      o.stop(t + 0.3)
    }
  }

  /** Driving state: engine pitch + volume follow the speed. */
  setEngine(active: boolean, speed: number, kind: string) {
    if (!this.ready || !this.ctx || !this.engineGain || !this.engineOsc || !this.engineOsc2 || !this.engineFilter) return
    const t = this.ctx.currentTime
    const base = kind === 'okada' ? 90 : kind === 'keke' ? 74 : kind === 'plane' ? 48 : kind === 'boat' ? 40 : 58
    const target = active ? 0.05 + Math.min(0.11, Math.abs(speed) * 0.0035) : 0
    this.engineGain.gain.setTargetAtTime(target, t, 0.12)
    this.engineOsc.frequency.setTargetAtTime(base + Math.abs(speed) * 2.6, t, 0.1)
    this.engineOsc2.frequency.setTargetAtTime((base + Math.abs(speed) * 2.6) * 0.5, t, 0.1)
    this.engineFilter.frequency.setTargetAtTime(260 + Math.abs(speed) * 16, t, 0.15)
  }

  // ---- NEPA generator: a two-stroke "I better pass my neighbour" drone
  private genOsc: OscillatorNode | null = null
  private genGain: GainNode | null = null
  setGenerator(on: boolean) {
    if (!this.ready || !this.ctx || !this.ambBus) return
    const ctx = this.ctx
    if (!this.genOsc) {
      this.genOsc = ctx.createOscillator()
      this.genOsc.type = 'sawtooth'
      this.genOsc.frequency.value = 52
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 7.5
      const lfoG = ctx.createGain()
      lfoG.gain.value = 6
      lfo.connect(lfoG).connect(this.genOsc.frequency)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 380
      this.genGain = ctx.createGain()
      this.genGain.gain.value = 0
      this.genOsc.connect(f).connect(this.genGain).connect(this.ambBus)
      this.genOsc.start()
      lfo.start()
    }
    this.genGain!.gain.setTargetAtTime(on ? 0.035 : 0, ctx.currentTime, on ? 0.8 : 0.3)
  }

  // ------------------------------------------------------------ one shots
  footstep(onRoad: boolean) {
    if (!this.ready || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(0.09)
    const bp = ctx.createBiquadFilter()
    bp.type = onRoad ? 'bandpass' : 'lowpass'
    bp.frequency.value = onRoad ? 900 + Math.random() * 300 : 300 + Math.random() * 120
    const g = ctx.createGain()
    g.gain.setValueAtTime(onRoad ? 0.09 : 0.06, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    src.connect(bp).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + 0.1)
  }

  horn(kind: string) {
    if (!this.ready || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const dur = 0.45
    const freqs = kind === 'bus' ? [300, 240] : kind === 'keke' ? [620, 780] : kind === 'okada' ? [820] : [420, 505]
    for (const f of freqs) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.055, t + 0.02)
      g.gain.setValueAtTime(0.055, t + dur - 0.06)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g).connect(this.master)
      o.start(t)
      o.stop(t + dur + 0.02)
    }
  }

  chime(success = true) {
    if (!this.ready || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const notes = success ? [523.25, 783.99] : [311, 233]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = ctx.createGain()
      const at = t + i * 0.11
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.08, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4)
      o.connect(g).connect(this.master!)
      o.start(at)
      o.stop(at + 0.45)
    })
  }

  talkBlip() {
    if (!this.ready || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(340, t)
    o.frequency.exponentialRampToValueAtTime(480, t + 0.08)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 0.16)
  }

  // ------------------------------------------------------------ scheduled
  private chirp() {
    if (!this.ctx || !this.ambBus) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const n = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.09 + Math.random() * 0.08)
      const o = ctx.createOscillator()
      o.type = 'sine'
      const f = 2200 + Math.random() * 1400
      o.frequency.setValueAtTime(f, at)
      o.frequency.exponentialRampToValueAtTime(f * (0.6 + Math.random() * 0.5), at + 0.07)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.016, at + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09)
      o.connect(g).connect(this.ambBus)
      o.start(at)
      o.stop(at + 0.1)
    }
  }

  private cricket() {
    if (!this.ctx || !this.ambBus) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = 4200 + Math.random() * 600
    const g = ctx.createGain()
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 26
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.008
    g.gain.value = 0.011
    lfo.connect(lfoGain).connect(g.gain)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(1, t + 0.05)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    o.connect(g).connect(env).connect(this.ambBus)
    o.start(t)
    lfo.start(t)
    o.stop(t + 0.55)
    lfo.stop(t + 0.55)
  }

  private voiceBlip(strength: number) {
    if (!this.ctx || !this.ambBus) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    const f = 130 + Math.random() * 190
    o.frequency.setValueAtTime(f, t)
    o.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.7), t + 0.22)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 700
    bp.Q.value = 1.6
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.02 * strength, t + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
    o.connect(bp).connect(g).connect(this.ambBus)
    o.start(t)
    o.stop(t + 0.3)
  }

  private trainHorn(prox: number) {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime
    for (const f of [233, 311]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.02 * prox, t + 0.08)
      g.gain.setValueAtTime(0.02 * prox, t + 0.7)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      o.connect(lp).connect(g).connect(this.master)
      o.start(t)
      o.stop(t + 1.05)
    }
  }
}

export const kkAudio = new KKAudio()

/** Distance based zone helper, called from AudioSystem a few times a second. */
export function zoneLevels(
  px: number,
  pz: number,
  night: number
): Zones {
  const market = BAKE_LANDMARK_MARKET
  const dMarket = Math.hypot(px - market[0], pz - market[1])
  const marketLevel = Math.max(0, 1 - dMarket / 140)
  const dWater = waterDistApprox(px, pz)
  const waterLevel = Math.max(0, 1 - dWater / 90)
  const railLevel = Math.max(0, 1 - railDistApprox(px, pz) / 320)
  return {
    market: marketLevel * marketLevel,
    water: waterLevel * waterLevel,
    night,
    rail: railLevel
  }
}

// lazy imports avoided: small local copies of the two distances we need
const BAKE_LANDMARK_MARKET: [number, number] = [-80 * WORLD_SCALE, 102 * WORLD_SCALE]
function waterDistApprox(x: number, z: number): number {
  // river main stem approximated as a coarse polyline: cheap and good
  // enough for audio falloff
  let best = 1200
  const pts = RIVER_APPROX
  for (let i = 0; i < pts.length; i += 2) {
    const d = Math.hypot(pts[i] - x, pts[i + 1] - z)
    if (d < best) best = d
  }
  return best
}

// coarse river polyline sampled from the bake within the city bounds
const RIVER_APPROX: number[] = [
  572, -661, 493, -338, 296, 142, -9, 510, -320, 341, -532, 576, -1224, 417,
  -1786, 600, -1739, 929
].map((v) => v * WORLD_SCALE)

// railway main line approximation for the train horn zone
function railDistApprox(x: number, z: number): number {
  const pts = RAIL_APPROX
  let best = 2700
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i]
    const az = pts[i + 1]
    const bx = pts[i + 2]
    const bz = pts[i + 3]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    let t = ((x - ax) * dx + (z - az) * dz) / len2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z)
    if (d < best) best = d
  }
  return best
}

const RAIL_APPROX: number[] = [
  -213, 369, -464, 719, -529, 1266, -564, 1647, -684, 2022
].map((v) => v * WORLD_SCALE)
