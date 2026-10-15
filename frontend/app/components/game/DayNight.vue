<script setup lang="ts">
import { perf as _perf } from '~/utils/quality'
const FOG_MAX = _perf().fogMax
// DayNight - the living clock of the world. Advances the in-game hour,
// paints the sky + fog, drives every light intensity, and owns everything
// that glows after dark: house windows, streetlamps (glow + light pools +
// the four point lights that follow you), the stars and the moon.
// Press N (or tap the clock chip) to jump two hours.
import * as THREE from 'three'
import { useClock, useClockSpeed, sunState, skyPalette, mixHex, clockSpeedAt } from '~/composables/useTimeOfDay'
import { streetlights, windowLights } from '~/utils/kadunaLighting'
import { weather } from '~/utils/weather'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const hour = useClock()
const daySeconds = useClockSpeed()
// shared night factor (0 day .. 1 night) for headlights, minimap, audio
const nightFactor = useState<number>('kk_night', () => 0)
// city calendar day counter + NEPA power state (LifeEvents drives the cuts)
const gameDay = useState<number>('kk_day', () => 1)
const nepa = useState<{ off: boolean; since: number }>('kk_nepa', () => ({ off: false, since: 0 }))

const ctxAny = useTresContext() as any
const { onBeforeRender } = useLoop()

const moonRef = ref<THREE.Sprite | null>(null)
const sunDiscRef = ref<THREE.Sprite | null>(null)
const windowGlowRef = ref<THREE.Mesh | null>(null)
const lampGlowRef = ref<THREE.Mesh | null>(null)
const poolRef = ref<THREE.Mesh | null>(null)
let stars: THREE.Points | null = null
const pLights: Array<THREE.PointLight | null> = [null, null, null, null]

let lamps: ReturnType<typeof streetlights> = []
let relightTimer = 0
const skyC = new THREE.Color('#9ec7de')
const fogC = new THREE.Color('#b8d2e0')
let ambientLight: THREE.AmbientLight | null = null
let hemiLight: THREE.HemisphereLight | null = null

// window glow quads: one merged unlit mesh whose opacity follows night
function buildQuadMesh(
  quads: Array<{ x: number; y: number; z: number; rx: number; rz: number; h: number; color: string }>,
  pool = false
): THREE.Mesh | null {
  if (!quads.length) return null
  const pos: number[] = []
  const col: number[] = []
  const c = new THREE.Color()
  for (const q of quads) {
    const rx = q.rx
    const rz = q.rz
    const y0 = q.y - q.h
    const y1 = q.y + q.h
    c.set(q.color)
    if (pool) c.multiplyScalar(0.55)
    const quad = [
      [q.x + rx, y1, q.z + rz],
      [q.x - rx, y1, q.z - rz],
      [q.x - rx, y0, q.z - rz],
      [q.x + rx, y1, q.z + rz],
      [q.x - rx, y0, q.z - rz],
      [q.x + rx, y0, q.z + rz]
    ]
    for (const [x, y, z] of quad) {
      pos.push(x, y, z)
      col.push(c.r, c.g, c.b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: !pool
  })
  const mesh = new THREE.Mesh(g, mat)
  return mesh
}

onMounted(() => {
  lamps = streetlights()

  // glow meshes live outside TresJS templates: added straight to the scene
  const scene = ctxAny?.scene?.value ?? ctxAny?.scene
  if (scene) {
    // the canvas was created with a clear color but no scene background:
    // give it one so the sky painter can drive it
    if (!scene.background) scene.background = new THREE.Color('#9ec7de')
    // grab the static lights so their intensity follows the clock
    scene.traverse((o: THREE.Object3D) => {
      if ((o as THREE.AmbientLight).isAmbientLight) ambientLight = o as THREE.AmbientLight
      if ((o as THREE.HemisphereLight).isHemisphereLight) hemiLight = o as THREE.HemisphereLight
    })
    const wl = windowLights()
    const lit = wl.quads.filter((_, i) => wl.lit[i] > 0)
    const win = buildQuadMesh(lit)
    if (win) {
      windowGlowRef.value = win
      scene.add(win)
    }
    const lampQuads: Array<{ x: number; y: number; z: number; rx: number; rz: number; h: number; color: string }> = []
    for (const l of lamps) {
      // crossed quads so the halo reads from any direction
      lampQuads.push({ x: l.x, y: l.y, z: l.z, rx: 0.85, rz: 0, h: 0.85, color: '#ffd98a' })
      lampQuads.push({ x: l.x, y: l.y, z: l.z, rx: 0, rz: 0.85, h: 0.85, color: '#ffd98a' })
    }
    const lg = buildQuadMesh(lampQuads)
    if (lg) {
      lampGlowRef.value = lg
      scene.add(lg)
    }
    // warm light pools on the tarmac under each lamp
    const poolQuads = lamps.map((l) => ({
      x: l.x,
      y: 0.09,
      z: l.z,
      rx: 3.4,
      rz: 0,
      h: 2.4,
      color: '#c8a35a'
    }))
    const pg = buildQuadMesh(poolQuads, true)
    if (pg) {
      poolRef.value = pg
      scene.add(pg)
    }
    // the four point lights that follow the player at night
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.PointLight('#ffd98a', 0, 46, 1.6)
      pLights[i] = pl
      scene.add(pl)
    }
    // star field on a dome above the city
    const starPos: number[] = []
    for (let i = 0; i < 750; i++) {
      const a = Math.random() * Math.PI * 2
      const e = Math.random() * 0.5 + 0.08 // above the horizon
      const r = 1900
      starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
    stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        size: 2.6,
        sizeAttenuation: false,
        color: '#e8ecff',
        transparent: true,
        opacity: 0,
        fog: false,
        depthWrite: false
      })
    )
    scene.add(stars)
  }

  // N jumps two hours
  window.addEventListener('kk-time-skip', onSkip)
})

onBeforeUnmount(() => {
  window.removeEventListener('kk-time-skip', onSkip)
  const scene = ctxAny?.scene?.value ?? ctxAny?.scene
  for (const m of [windowGlowRef.value, lampGlowRef.value, poolRef.value]) {
    if (m) {
      scene?.remove?.(m)
      m.geometry.dispose()
    }
  }
  if (stars) {
    scene?.remove?.(stars)
    stars.geometry.dispose()
  }
  for (const pl of pLights) if (pl) scene?.remove?.(pl)
})

function onSkip() {
  hour.value = (hour.value + 2) % 24
  // publish the new night factor immediately (the render loop would
  // otherwise leave the old value visible until the next frame lands)
  nightFactor.value = sunState(hour.value).night
}

// moon + sun disc textures (soft radial gradients, drawn once)
let moonTex: THREE.CanvasTexture | null = null
let sunTex: THREE.CanvasTexture | null = null
function makeDiscTexture(inner: string, outer: string, halo: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62)
  grad.addColorStop(0, inner)
  grad.addColorStop(0.42, outer)
  grad.addColorStop(1, halo)
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(cv)
}

onMounted(() => {
  moonTex = makeDiscTexture('#f4f2e8', '#d8d8e2', 'rgba(190,200,230,0)')
  sunTex = makeDiscTexture('#fff8e0', '#ffd98a', 'rgba(255,180,90,0)')
  if (moonRef.value) (moonRef.value.material as THREE.SpriteMaterial).map = moonTex
  if (sunDiscRef.value) (sunDiscRef.value.material as THREE.SpriteMaterial).map = sunTex
})

// ---------------------------------------------------------------- loop
onBeforeRender(({ delta, elapsed }) => {
  // 1) advance the clock (night hours slip by ~2.2x faster: long days,
  //    short nights - see clockSpeedAt)
  const dt = Math.min(delta || 0.016, 0.1)
  const before = hour.value
  hour.value =
    (hour.value + (dt * 24 * clockSpeedAt(hour.value)) / Math.max(30, daySeconds.value)) % 24
  if (hour.value < before - 12) gameDay.value++ // midnight: a new day on the city calendar

  const s = sunState(hour.value)
  nightFactor.value = s.night
  const pal = skyPalette(s)

  // 2) sky + fog + global light levels, bent by the weather: grey skies
  //    under cloud and rain, a dusty ochre haze in the harmattan
  const w = weather.cur
  const overcast = Math.min(1, w.cloud * 0.55 + w.rain * 0.4 + w.storm * 0.2)
  skyC.set(mixHex(mixHex(pal.sky, s.night > 0.6 ? '#1a1f2a' : '#8d97a2', overcast), '#d6c49a', w.haze * 0.75 * (1 - s.night * 0.6)))
  fogC.set(mixHex(mixHex(pal.fog, s.night > 0.6 ? '#20242c' : '#9aa2aa', overcast), '#cdb68a', w.haze * 0.85 * (1 - s.night * 0.6)))
  if (weather.flash > 0) {
    skyC.lerp(new THREE.Color('#dfe6ff'), weather.flash * 0.7)
  }
  const scene = ctxAny?.scene?.value ?? ctxAny?.scene
  const renderer = ctxAny?.renderer?.instance ?? ctxAny?.renderer?.value
  if (scene) {
    if (!scene.background) scene.background = new THREE.Color()
    if (scene.background && (scene.background as THREE.Color).isColor) {
      ;(scene.background as THREE.Color).copy(skyC)
    }
    if (scene.fog) {
      ;(scene.fog as THREE.Fog).color.copy(fogC)
      const far = Math.min(FOG_MAX, (4600 - s.night * 2400) * (1 - w.haze * 0.72) * (1 - w.rain * 0.45))
      ;(scene.fog as THREE.Fog).far += (far - (scene.fog as THREE.Fog).far) * Math.min(1, dt * 2)
    }
  }
  if (renderer && typeof renderer.setClearColor === 'function') {
    renderer.setClearColor(skyC)
  }
  if (ambientLight) {
    ambientLight.intensity = (0.3 + s.daylight * 0.3) * (1 - overcast * 0.22) + weather.flash * 1.6
    ambientLight.color.set(pal.ambient)
  }
  if (hemiLight) {
    hemiLight.intensity = 0.2 + s.daylight * 0.85
    hemiLight.color.set(mixHex('#d4e6f4', '#2c3c66', s.night))
  }

  // 3) stars + moon + sun disc ride with the camera x/z
  const px = playerPos.value[0]
  const pz = playerPos.value[2]
  if (stars) {
    stars.position.set(px, 0, pz)
    const m = stars.material as THREE.PointsMaterial
    m.opacity = Math.max(0, s.night - 0.25) / 0.75
    stars.visible = m.opacity > 0.02
    stars.rotation.y = elapsed * 0.004
  }
  if (moonRef.value) {
    const mx = px - s.sx * 1500
    const my = -s.sy * 1200 + 160
    const mz = pz - s.sz * 1500
    moonRef.value.position.set(mx, my, mz)
    moonRef.value.visible = s.night > 0.3
    ;(moonRef.value.material as THREE.SpriteMaterial).opacity = Math.min(1, s.night * 1.3)
  }
  if (sunDiscRef.value) {
    sunDiscRef.value.position.set(px + s.sx * 1600, s.sy * 1300 + 60, pz + s.sz * 1600)
    sunDiscRef.value.visible = s.sy > -0.05
    ;(sunDiscRef.value.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, s.sy * 3 + 0.4))
  }

  // 4) night glows
  if (windowGlowRef.value) {
    const m = windowGlowRef.value.material as THREE.MeshBasicMaterial
    // NEPA cut: only the houses with a generator stay lit
    m.opacity = Math.max(0, (s.night - 0.28) / 0.72) * 0.85 * (nepa.value.off ? 0.3 : 1)
    windowGlowRef.value.visible = m.opacity > 0.01
  }
  if (lampGlowRef.value && poolRef.value) {
    const on = Math.max(0, (s.night - 0.22) / 0.78) * (nepa.value.off ? 0 : 1)
    const mg = lampGlowRef.value.material as THREE.MeshBasicMaterial
    mg.opacity = on * 0.9
    lampGlowRef.value.visible = on > 0.01
    const mp = poolRef.value.material as THREE.MeshBasicMaterial
    mp.opacity = on * 0.5
    poolRef.value.visible = on > 0.01
  }

  // 5) four streetlight point lights follow the player at night
  relightTimer -= dt
  if (relightTimer <= 0) {
    relightTimer = 0.5
    if (lamps.length && pLights[0]) {
      const near = lamps
        .map((l) => ({ l, d: Math.hypot(l.x - px, l.z - pz) }))
        .filter((e) => e.d < 130)
        .sort((a, b) => a.d - b.d)
        .slice(0, 4)
      for (let i = 0; i < 4; i++) {
        const pl = pLights[i]!
        if (i < near.length) {
          pl.position.set(near[i].l.x, near[i].l.y, near[i].l.z)
          pl.userData.hasLamp = true
        } else {
          pl.userData.hasLamp = false
        }
      }
    }
  }
  const glowI = Math.max(0, (s.night - 0.3) / 0.7)
  for (const pl of pLights) {
    if (!pl) continue
    pl.intensity = pl.userData.hasLamp ? glowI * 26 : 0
  }
})

// headless probes
if (import.meta.dev) {
  ;(window as any).__kk_time = () => ({
    hour: +hour.value.toFixed(2),
    night: +nightFactor.value.toFixed(2)
  })
  ;(window as any).__kk_sethour = (h: number) => (hour.value = h)
}
</script>

<template>
  <TresGroup>
    <TresSprite ref="moonRef" :visible="false" :scale="[110, 110, 1]">
      <TresSpriteMaterial :transparent="true" :opacity="0" :depth-write="false" :fog="false" />
    </TresSprite>
    <TresSprite ref="sunDiscRef" :visible="false" :scale="[190, 190, 1]">
      <TresSpriteMaterial :transparent="true" :opacity="0" :depth-write="false" :fog="false" />
    </TresSprite>
  </TresGroup>
</template>
