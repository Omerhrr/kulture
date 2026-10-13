<script setup lang="ts">
// SkyDome - a real sky instead of a flat clear colour: deep blue at the
// zenith fading to a pale, hazy horizon that matches the fog colour (so
// distant land melts into the sky - aerial perspective), a warm glow
// around the sun, and soft drifting fair-weather clouds whose cover
// follows the weather. A distant ring of blue hills sits on the horizon.
import * as THREE from 'three'
import { useClock, sunState } from '~/composables/useTimeOfDay'
import { weather } from '~/utils/weather'
import { hash01 } from '~/utils/kadunaExtras'

const hour = useClock()
const ctx = useTresContext() as any

const uniforms = {
  uZenith: { value: new THREE.Color('#3f78c4') },
  uHorizon: { value: new THREE.Color('#cfdde6') },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color('#fff2d8') },
  uTime: { value: 0 },
  uCloud: { value: 0.35 },
  uNight: { value: 0 }
}

const skyMat = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }`,
  fragmentShader: `
    uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol;
    uniform float uTime; uniform float uCloud; uniform float uNight;
    varying vec3 vDir;
    float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += vn(p) * a; p *= 2.03; a *= 0.5; } return v; }
    void main() {
      vec3 d = normalize(vDir);
      float up = max(d.y, 0.0);
      // horizon band is wide and pale, zenith deep
      vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
      // below the horizon: keep the haze colour (hidden by the hill ring)
      if (d.y < 0.0) col = uHorizon;
      // sun glow + disc
      float sd = max(dot(d, normalize(uSunDir)), 0.0);
      col += uSunCol * (pow(sd, 8.0) * 0.25 + pow(sd, 90.0) * 0.6) * (1.0 - uNight);
      // clouds: projected onto a flat layer, thinning toward the horizon
      if (d.y > 0.02) {
        vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
        float n = fbm(cp);
        float c = smoothstep(1.0 - uCloud * 0.9 - 0.25, 1.0 - uCloud * 0.9 + 0.2, n);
        c *= smoothstep(0.02, 0.25, d.y);
        vec3 lit = mix(vec3(1.0, 0.99, 0.97), uSunCol, 0.15);
        vec3 shade = mix(uHorizon, vec3(0.62, 0.66, 0.72), 0.5);
        vec3 cc = mix(shade, lit, smoothstep(0.35, 0.85, fbm(cp * 1.7 + 3.1)));
        cc = mix(cc, uZenith * 0.4, uNight * 0.85);
        col = mix(col, cc, c * 0.92);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
})
const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMat)
sky.frustumCulled = false
sky.renderOrder = -10

// distant hill ring: layered ridgelines that fog turns to blue silhouettes
function ridgeRing(radius: number, height: number, salt: number) {
  const seg = 256
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    let h = 0
    let amp = 1
    let f = 3
    for (let o = 0; o < 4; o++) {
      const t = (a / (Math.PI * 2)) * f
      const k = Math.floor(t)
      const fr = t - k
      const s = fr * fr * (3 - 2 * fr)
      h += (hash01(k % f, salt, o) * (1 - s) + hash01((k + 1) % f, salt, o) * s) * amp
      amp *= 0.5
      f *= 2
    }
    const y = height * (0.25 + h * 0.6)
    const x = Math.sin(a) * radius
    const z = Math.cos(a) * radius
    pos.push(x, -60, z, x, y, z)
    if (i < seg) {
      const b = i * 2
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
const ringMatNear = new THREE.MeshBasicMaterial({ color: '#7d8a6c', side: THREE.DoubleSide, fog: true })
const ringMatFar = new THREE.MeshBasicMaterial({ color: '#8e9cab', side: THREE.DoubleSide, fog: true })
const ringNear = new THREE.Mesh(ridgeRing(2500, 190, 3), ringMatNear)
const ringFar = new THREE.Mesh(ridgeRing(3600, 380, 9), ringMatFar)
for (const r of [ringNear, ringFar]) r.frustumCulled = false

const group = new THREE.Group()
group.add(sky, ringFar, ringNear)

const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed }) => {
  const cam = ctx.camera?.activeCamera?.value ?? ctx.camera?.value
  if (cam) group.position.set(cam.position.x, 0, cam.position.z)
  const s = sunState(hour.value)
  uniforms.uSunDir.value.set(s.sx, s.sy, s.sz)
  uniforms.uTime.value = elapsed
  uniforms.uNight.value = s.night
  uniforms.uCloud.value = Math.min(1, 0.16 + weather.cur.cloud * 0.6 + weather.cur.rain * 0.4)
  const scene = ctx.scene?.value ?? ctx.scene
  // horizon = fog colour (DayNight paints it), zenith = a deeper sky blue
  const fogC: THREE.Color | undefined = scene?.fog?.color
  const bg: THREE.Color | undefined = scene?.background?.isColor ? scene.background : undefined
  if (fogC) uniforms.uHorizon.value.copy(fogC)
  if (bg) {
    uniforms.uZenith.value.copy(bg).multiplyScalar(0.62)
    uniforms.uZenith.value.b = Math.min(1, uniforms.uZenith.value.b * 1.12)
  }
  const sunHex = s.dusk > 0.05 ? '#ffb070' : '#fff1d6'
  uniforms.uSunCol.value.set(sunHex)
  // the ridges dim at night
  const k = 1 - s.night * 0.8
  ringMatNear.color.set('#7d8a6c').multiplyScalar(k)
  ringMatFar.color.set('#8e9cab').multiplyScalar(k)
})

onBeforeUnmount(() => {
  sky.geometry.dispose()
  skyMat.dispose()
  ringNear.geometry.dispose()
  ringFar.geometry.dispose()
})
</script>

<template>
  <primitive :object="group" />
</template>
