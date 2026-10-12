<script setup lang="ts">
import { getQuality } from '~/utils/quality'
// Weather - renders whatever utils/weather.ts says the sky is doing:
// slanted rain streaks around the camera, drifting cloud decks, harmattan
// dust, lightning flashes, and keeps the HUD label + audio in sync.
// Press Y (or tap the weather chip) to change the weather for a demo.
import * as THREE from 'three'
import { weather, stepWeather, setWeather, onThunder, WEATHER_LABEL, type WeatherKind } from '~/utils/weather'
import { kkAudio } from '~/utils/audio'
import { useIsTouch } from '~/composables/useControlsState'

const ctx = useTresContext() as any
const label = useState<string>('kk_weather_label', () => WEATHER_LABEL.sunny)
const isTouch = useIsTouch()

const root = new THREE.Group()

// ---------------------------------------------------------------- rain
const DROPS = isTouch.value || getQuality() === 'low' ? 2200 : 5200
const BOX = { w: 70, h: 34 }
const rainPos = new Float32Array(DROPS * 6)
const rainSeed = new Float32Array(DROPS * 3)
for (let i = 0; i < DROPS; i++) {
  rainSeed[i * 3] = (Math.random() - 0.5) * BOX.w
  rainSeed[i * 3 + 1] = Math.random() * BOX.h
  rainSeed[i * 3 + 2] = (Math.random() - 0.5) * BOX.w
}
const rainGeo = new THREE.BufferGeometry()
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
const rainMat = new THREE.LineBasicMaterial({ color: '#c8d4e0', transparent: true, opacity: 0, depthWrite: false })
const rain = new THREE.LineSegments(rainGeo, rainMat)
rain.frustumCulled = false
root.add(rain)

// ---------------------------------------------------------------- clouds
function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  for (let i = 0; i < 26; i++) {
    const x = 40 + Math.random() * 176
    const y = 50 + Math.random() * 40
    const r = 18 + Math.random() * 34
    const grad = g.createRadialGradient(x, y, 2, x, y, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  return new THREE.CanvasTexture(c)
}
const cloudTex = cloudTexture()
const CLOUDS = 46
const clouds: Array<{ s: THREE.Sprite; ox: number; oz: number; y: number }> = []
for (let i = 0; i < CLOUDS; i++) {
  const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false })
  const s = new THREE.Sprite(mat)
  const w = 380 + Math.random() * 420
  s.scale.set(w, w * 0.42, 1)
  const a = Math.random() * Math.PI * 2
  const r = 200 + Math.random() * 1700
  clouds.push({ s, ox: Math.cos(a) * r, oz: Math.sin(a) * r, y: 260 + Math.random() * 140 })
  root.add(s)
}
let drift = 0

// ---------------------------------------------------------------- dust
const DUST = isTouch.value ? 700 : 1600
const dustPos = new Float32Array(DUST * 3)
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 90
  dustPos[i * 3 + 1] = Math.random() * 18
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 90
}
const dustGeo = new THREE.BufferGeometry()
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
const dustMat = new THREE.PointsMaterial({ color: '#c9a76a', size: 0.12, transparent: true, opacity: 0, depthWrite: false })
const dust = new THREE.Points(dustGeo, dustMat)
dust.frustumCulled = false
root.add(dust)
const dustBase = dustPos.slice()

// ---------------------------------------------------------------- loop
const camPos = new THREE.Vector3()
let lastKind: WeatherKind = weather.kind
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta, elapsed }) => {
  const dt = Math.min(delta || 0.016, 0.1)
  stepWeather(dt, elapsed)
  const w = weather.cur
  const cam = ctx.camera?.activeCamera?.value
  if (cam) camPos.copy(cam.position)

  // rain: streak length + slant follow intensity and wind
  rainMat.opacity = Math.min(0.55, w.rain * 0.7)
  rain.visible = w.rain > 0.02
  if (rain.visible) {
    const fall = 22 + w.rain * 10
    const len = 0.5 + w.rain * 0.7
    const slant = w.wind * 0.45
    const n = Math.floor(DROPS * Math.min(1, 0.25 + w.rain))
    for (let i = 0; i < DROPS; i++) {
      let y = rainSeed[i * 3 + 1] - fall * dt
      if (y < 0) y += BOX.h
      rainSeed[i * 3 + 1] = y
      const o = i * 6
      if (i >= n) {
        rainPos[o + 1] = rainPos[o + 4] = -999
        continue
      }
      // the rain box rides with the camera so it never runs out
      const wx = camPos.x + rainSeed[i * 3]
      const wz = camPos.z + rainSeed[i * 3 + 2]
      const wy = camPos.y - 12 + y
      rainPos[o] = wx
      rainPos[o + 1] = wy
      rainPos[o + 2] = wz
      rainPos[o + 3] = wx - slant * len * 2
      rainPos[o + 4] = wy + len
      rainPos[o + 5] = wz - slant * len
    }
    rainGeo.attributes.position.needsUpdate = true
  }

  // clouds ride the wind; darker and lower in storms
  drift += dt * (4 + w.wind * 22)
  const grey = 1 - w.storm * 0.55 - w.rain * 0.15
  for (const c of clouds) {
    const m = c.s.material as THREE.SpriteMaterial
    m.opacity = Math.max(0, Math.min(0.92, (w.cloud - 0.05) * 1.1))
    m.color.setRGB(grey, grey, grey * 1.02)
    let x = c.ox + drift
    x = ((x + 1900) % 3800) - 1900
    c.s.position.set(camPos.x + x, c.y - w.storm * 60, camPos.z + c.oz)
    c.s.visible = m.opacity > 0.02
  }

  // harmattan dust swirling in the wind
  dustMat.opacity = w.haze * 0.75
  dust.visible = w.haze > 0.03
  if (dust.visible) {
    for (let i = 0; i < DUST; i++) {
      const o = i * 3
      const t = elapsed * (0.6 + (i % 7) * 0.08)
      dustPos[o] = camPos.x + ((dustBase[o] + elapsed * w.wind * 5 + 45) % 90) - 45 + Math.sin(t + i) * 0.6
      dustPos[o + 1] = dustBase[o + 1] + Math.sin(t * 0.7 + i) * 0.8
      dustPos[o + 2] = camPos.z + dustBase[o + 2] + Math.cos(t + i * 0.3) * 0.6
    }
    dustGeo.attributes.position.needsUpdate = true
  }

  if (weather.kind !== lastKind) {
    lastKind = weather.kind
    label.value = WEATHER_LABEL[weather.kind]
  }
  kkAudio.setWeather(w.rain, w.wind, w.storm)
})

onThunder((delay, strength) => {
  window.setTimeout(() => kkAudio.thunder(strength), delay * 1000)
})

function onCycle(e: Event) {
  const k = (e as CustomEvent).detail as WeatherKind | undefined
  if (k) setWeather(k)
  else {
    const order: WeatherKind[] = ['sunny', 'cloudy', 'rain', 'storm', 'harmattan']
    setWeather(order[(order.indexOf(weather.kind) + 1) % order.length])
  }
  label.value = WEATHER_LABEL[weather.kind]
}

onMounted(() => {
  window.addEventListener('kk-weather', onCycle)
  if (import.meta.dev) {
    ;(window as any).__kk_weather = (k?: WeatherKind) => {
      if (k) setWeather(k, true)
      return { kind: weather.kind, ...weather.cur, timer: Math.round(weather.timer) }
    }
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-weather', onCycle)
  rainGeo.dispose()
  dustGeo.dispose()
  cloudTex.dispose()
})
</script>

<template>
  <primitive :object="root" />
</template>
