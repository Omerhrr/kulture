<script setup lang="ts">
// Kajuru Castle - a separate weekend-trip mini-experience built with
// Babylon.js (the main city stays on three.js). Walk the granite rocks
// around the castle at golden hour, climb to the battlements, find the
// four viewpoints and take in the valley. WASD / arrows + mouse, or the
// on-screen pad on phones. "Back to Kaduna" returns to the city.
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import '@babylonjs/core/Collisions/collisionCoordinator'

definePageMeta({ layout: false })
useHead({ title: 'Kajuru Castle · Kaduna Kulture' })

const canvas = ref<HTMLCanvasElement | null>(null)
const found = ref<string[]>([])
const info = ref<string | null>(null)
const ready = ref(false)
const VIEWS = [
  { id: 'gate', name: 'The Gatehouse', text: 'Built in the late 1980s by a German expatriate, Kajuru Castle was modelled on medieval European castles - in the middle of Kaduna State.' },
  { id: 'rocks', name: 'Granite Rocks', text: 'The castle sits on ancient granite outcrops typical of southern Kaduna. Climbers love the boulders around it.' },
  { id: 'valley', name: 'Valley View', text: 'From here you can see Kajuru village and the Kaduna hills rolling away to the south.' },
  { id: 'tower', name: 'The Battlements', text: 'Weekend visitors come for the view, the pool, and to sleep in a real castle room.' }
]
let engine: Engine | null = null

function mat(scene: Scene, name: string, hex: string, rough = true) {
  const m = new StandardMaterial(name, scene)
  m.diffuseColor = Color3.FromHexString(hex)
  m.specularColor = rough ? new Color3(0.05, 0.05, 0.05) : new Color3(0.4, 0.4, 0.4)
  return m
}
function stoneTexture(scene: Scene, hex: string) {
  const t = new DynamicTexture('stone' + hex, { width: 256, height: 256 }, scene, true)
  const g = t.getContext() as CanvasRenderingContext2D
  g.fillStyle = hex
  g.fillRect(0, 0, 256, 256)
  // block courses with mortar lines
  for (let y = 0; y < 256; y += 32) {
    const off = (y / 32) % 2 ? 24 : 0
    for (let x = -off; x < 256; x += 48) {
      g.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.12})`
      g.fillRect(x + 2, y + 2, 44, 28)
    }
    g.fillStyle = 'rgba(40,25,15,0.5)'
    g.fillRect(0, y, 256, 2)
  }
  t.update()
  return t
}

onMounted(() => {
  const cv = canvas.value!
  engine = new Engine(cv, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.98, 0.78, 0.55, 1)
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.004
  scene.fogColor = new Color3(0.96, 0.8, 0.62)
  scene.gravity = new Vector3(0, -0.4, 0)
  scene.collisionsEnabled = true

  const cam = new UniversalCamera('cam', new Vector3(0, 4, -70), scene)
  cam.setTarget(new Vector3(0, 10, 0))
  cam.attachControl(cv, true)
  cam.applyGravity = true
  cam.checkCollisions = true
  cam.ellipsoid = new Vector3(0.6, 1.7, 0.6)
  cam.speed = 0.55
  cam.minZ = 0.1
  cam.keysUp.push(87)
  cam.keysDown.push(83)
  cam.keysLeft.push(65)
  cam.keysRight.push(68)

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.55
  hemi.groundColor = new Color3(0.45, 0.35, 0.25)
  const sun = new DirectionalLight('sun', new Vector3(-0.6, -0.5, 0.6), scene)
  sun.position = new Vector3(120, 120, -120)
  sun.intensity = 1.6
  sun.diffuse = new Color3(1, 0.82, 0.6)
  const shadows = new ShadowGenerator(2048, sun)
  shadows.useBlurExponentialShadowMap = true

  // ---- savanna ground with rolling hills
  const ground = MeshBuilder.CreateGround('ground', { width: 600, height: 600, subdivisions: 120, updatable: true }, scene)
  const pos = ground.getVerticesData(VertexBuffer.PositionKind)!
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!
    const z = pos[i + 2]!
    const d = Math.hypot(x, z)
    pos[i + 1] = Math.sin(x * 0.02) * Math.cos(z * 0.018) * 3 + Math.max(0, d - 150) * 0.12
  }
  ground.updateVerticesData(VertexBuffer.PositionKind, pos)
  ground.createNormals(true)
  const gm = mat(scene, 'grass', '#9a9a4e')
  ground.material = gm
  ground.receiveShadows = true
  ground.checkCollisions = true

  // ---- granite boulders (the rock the castle sits on + scattered)
  const granite = mat(scene, 'granite', '#9b8f84')
  const rocks: Mesh[] = []
  const boulder = (x: number, z: number, s: number, y = 0) => {
    const r = MeshBuilder.CreateIcoSphere('rock', { radius: s, subdivisions: 2, flat: true }, scene)
    r.scaling = new Vector3(1.2, 0.6 + Math.random() * 0.3, 1)
    r.rotation.y = Math.random() * 6
    r.position = new Vector3(x, y + s * 0.25, z)
    r.material = granite
    r.checkCollisions = true
    r.receiveShadows = true
    shadows.addShadowCaster(r)
    rocks.push(r)
  }
  const plinth = MeshBuilder.CreateCylinder('plinth', { diameterTop: 46, diameterBottom: 62, height: 7, tessellation: 11 }, scene)
  plinth.position.y = 3.5
  plinth.material = granite
  plinth.checkCollisions = true
  plinth.receiveShadows = true
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2
    const d = 34 + Math.random() * 30
    boulder(Math.cos(a) * d, Math.sin(a) * d, 2 + Math.random() * 5)
  }
  // a ramp up the rock to the gate
  const ramp = MeshBuilder.CreateBox('ramp', { width: 6, height: 0.6, depth: 22 }, scene)
  ramp.position = new Vector3(0, 3.4, -32)
  ramp.rotation.x = -0.3
  ramp.material = mat(scene, 'path', '#b8a07a')
  ramp.checkCollisions = true

  // ---- the castle
  const stone = mat(scene, 'stone', '#a9714c')
  stone.diffuseTexture = stoneTexture(scene, '#a9714c')
  const roof = mat(scene, 'roof', '#5b2e22')
  const dark = mat(scene, 'dark', '#2b1d16')
  const Y = 7
  const keep = MeshBuilder.CreateBox('keep', { width: 26, height: 16, depth: 26 }, scene)
  keep.position.y = Y + 8
  keep.material = stone
  keep.checkCollisions = true
  shadows.addShadowCaster(keep)
  for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) {
    const t = MeshBuilder.CreateCylinder('tower', { diameter: 8, height: 24, tessellation: 18 }, scene)
    t.position = new Vector3(x!, Y + 12, z!)
    t.material = stone
    t.checkCollisions = true
    shadows.addShadowCaster(t)
    const c = MeshBuilder.CreateCylinder('cone', { diameterTop: 0, diameterBottom: 9.6, height: 7, tessellation: 18 }, scene)
    c.position = new Vector3(x!, Y + 27.5, z!)
    c.material = roof
    shadows.addShadowCaster(c)
  }
  const central = MeshBuilder.CreateCylinder('central', { diameter: 9, height: 12, tessellation: 18 }, scene)
  central.position.y = Y + 22
  central.material = stone
  const ccone = MeshBuilder.CreateCylinder('ccone', { diameterTop: 0, diameterBottom: 10.6, height: 8, tessellation: 18 }, scene)
  ccone.position.y = Y + 32
  ccone.material = roof
  // battlements on the keep roof + a walkable roof deck reached by stairs
  for (let i = -6; i <= 6; i++) {
    for (const s of [-1, 1]) {
      const m1 = MeshBuilder.CreateBox('merlon', { size: 1.3 }, scene)
      m1.position = new Vector3(i * 2, Y + 16.6, s * 12.4)
      m1.material = stone
      const m2 = m1.clone('merlon2')
      m2.position = new Vector3(s * 12.4, Y + 16.6, i * 2)
    }
  }
  const deck = MeshBuilder.CreateBox('deck', { width: 24, height: 0.4, depth: 24 }, scene)
  deck.position.y = Y + 16
  deck.material = mat(scene, 'deck', '#8a5a3c')
  deck.checkCollisions = true
  // outside staircase hugging the keep's east wall
  for (let k = 0; k < 32; k++) {
    const st = MeshBuilder.CreateBox('step', { width: 3, height: 0.5, depth: 1 }, scene)
    st.position = new Vector3(14.6, Y + 0.25 + k * 0.5, -13 + k * 0.85)
    st.material = granite
    st.checkCollisions = true
  }
  const gate = MeshBuilder.CreateBox('gate', { width: 5, height: 7, depth: 0.6 }, scene)
  gate.position = new Vector3(0, Y + 3.5, -13.1)
  gate.material = dark
  for (const x of [-7, 7]) {
    const w = MeshBuilder.CreateBox('win', { width: 1.4, height: 2.6, depth: 0.3 }, scene)
    w.position = new Vector3(x, Y + 9, -13.1)
    w.material = dark
  }
  // pool beside the castle
  const pool = MeshBuilder.CreateBox('pool', { width: 12, height: 0.3, depth: 7 }, scene)
  pool.position = new Vector3(28, 7.2, 4)
  const water = mat(scene, 'water', '#3aa0c8', false)
  water.alpha = 0.85
  pool.material = water

  // trees: baobab-ish and neem
  const trunk = mat(scene, 'trunk', '#6b4a2f')
  const leaf = mat(scene, 'leaf', '#5f7f35')
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2
    const d = 70 + Math.random() * 160
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    const t = MeshBuilder.CreateCylinder('t', { diameterTop: 0.6, diameterBottom: 1.2, height: 5 }, scene)
    t.position = new Vector3(x, 2.5, z)
    t.material = trunk
    const c = MeshBuilder.CreateSphere('c', { diameter: 6 + Math.random() * 3, segments: 6 }, scene)
    c.position = new Vector3(x, 6.5, z)
    c.scaling.y = 0.7
    c.material = leaf
    shadows.addShadowCaster(c)
  }

  // ---- viewpoints: glowing markers you walk up to
  const spots: Record<string, Vector3> = {
    gate: new Vector3(0, Y, -18),
    rocks: new Vector3(-40, 2, 20),
    valley: new Vector3(36, Y, 22),
    tower: new Vector3(0, Y + 16.4, 0)
  }
  const glow = mat(scene, 'glow', '#ffd166')
  glow.emissiveColor = new Color3(1, 0.75, 0.3)
  for (const [id, p] of Object.entries(spots)) {
    const m = MeshBuilder.CreateTorus('spot_' + id, { diameter: 2.4, thickness: 0.18, tessellation: 24 }, scene)
    m.position = p.add(new Vector3(0, 0.2, 0))
    m.material = glow
  }

  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000
    for (const [id, p] of Object.entries(spots)) {
      const m = scene.getMeshByName('spot_' + id)
      if (m) m.position.y = p.y + 0.4 + Math.sin(t * 2) * 0.15
      if (Vector3.Distance(cam.position, p) < 3.4) {
        const v = VIEWS.find((x) => x.id === id)!
        if (!found.value.includes(id)) found.value = [...found.value, id]
        info.value = `${v.name}: ${v.text}`
      }
    }
    if (cam.position.y < -20) cam.position = new Vector3(0, 4, -70)
  })
  engine.runRenderLoop(() => scene.render())
  window.addEventListener('resize', onResize)
  ready.value = true
  ;(window as any).__kk_babylon = { scene, cam, found: () => found.value }
})
function onResize() {
  engine?.resize()
}
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  engine?.dispose()
})

// touch pad: hold to walk forward / turn
let held: any = null
function hold(dir: 'f' | 'b' | 'l' | 'r') {
  release()
  held = setInterval(() => {
    const cam = (window as any).__kk_babylon?.cam as UniversalCamera | undefined
    if (!cam) return
    if (dir === 'l') cam.rotation.y -= 0.04
    else if (dir === 'r') cam.rotation.y += 0.04
    else {
      const f = cam.getDirection(new Vector3(0, 0, dir === 'f' ? 1 : -1))
      f.y = 0
      cam.cameraDirection.addInPlace(f.normalize().scale(0.25))
    }
  }, 16)
}
function release() {
  clearInterval(held)
  held = null
}
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#f6c48a] text-ink">
    <canvas ref="canvas" class="h-full w-full touch-none outline-none" />
    <div class="pointer-events-none absolute inset-x-0 top-3 flex items-start justify-between px-3">
      <div class="pointer-events-auto rounded-2xl bg-white/90 px-4 py-2 shadow">
        <div class="font-display text-lg font-semibold">🏰 Kajuru Castle</div>
        <div class="text-xs text-ink/60">Weekend trip · viewpoints {{ found.length }}/4</div>
      </div>
      <NuxtLink to="/game" class="pointer-events-auto rounded-full bg-ink px-4 py-2 text-sm font-bold text-white shadow">‹ Back to Kaduna</NuxtLink>
    </div>
    <div v-if="info" class="absolute inset-x-0 bottom-28 mx-auto w-[min(520px,92vw)] rounded-2xl bg-white/95 p-3 text-sm shadow-lg">{{ info }}</div>
    <div v-if="found.length === 4" class="absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow">You've seen all of Kajuru! 📸</div>
    <div class="absolute bottom-4 left-4 grid grid-cols-3 gap-1 sm:hidden">
      <span />
      <button class="h-12 w-12 rounded-xl bg-white/80 text-xl" @pointerdown="hold('f')" @pointerup="release" @pointerleave="release">▲</button>
      <span />
      <button class="h-12 w-12 rounded-xl bg-white/80 text-xl" @pointerdown="hold('l')" @pointerup="release" @pointerleave="release">◀</button>
      <button class="h-12 w-12 rounded-xl bg-white/80 text-xl" @pointerdown="hold('b')" @pointerup="release" @pointerleave="release">▼</button>
      <button class="h-12 w-12 rounded-xl bg-white/80 text-xl" @pointerdown="hold('r')" @pointerup="release" @pointerleave="release">▶</button>
    </div>
    <div class="absolute bottom-4 right-4 hidden rounded-xl bg-white/80 px-3 py-2 text-xs sm:block">WASD / arrows to walk · drag to look · find the 4 glowing viewpoints</div>
  </div>
</template>
