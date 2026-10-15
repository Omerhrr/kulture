<script setup lang="ts">
// Character Studio - a Babylon.js character creator. Your real game
// character (the rigged african male / female) on a turntable under studio
// lights: pick skin, clothes, hair colour, ankara print and extras. The
// fabric is re-dyed with the same wardrobe code the city uses, so what you
// see here is exactly how you look in Kaduna. "Save & play" stores the look
// and returns you to the city.
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { SpotLight } from '@babylonjs/core/Lights/spotLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import '@babylonjs/loaders/glTF'
import { buildBaseFrom, dressCanvas, type BaseInfo, type MeshData } from '~/utils/wardrobe'
import { useSimStore } from '~/stores/sim'

definePageMeta({ layout: false })
useHead({ title: 'Character Studio · Kaduna Kulture' })

const sim = useSimStore()
const SKINS = ['#3a2216', '#4a2e1e', '#5e3a26', '#6e4630', '#7a4e33', '#8a5a3a', '#94603e', '#b07a52', '#c9946a']
const HAIR = ['#141114', '#3a2414', '#6b3e1e', '#9a6a2a', '#9a9a9a', '#7a2a3a']
const TOPS = ['#2e7d5b', '#efe8d6', '#2f5fa8', '#b23a48', '#e0a020', '#5a3a7a', '#1d1c1f', '#e86a2c', '#1f2a44', '#d86a8a', '#3a7d8a', '#8a6a3a', '#f2f2f0', '#6a8a2a']
const BOTTOMS = ['#2b3440', '#efe8d6', '#1d1c1f', '#6b4a2f', '#2f5fa8', '#7a2a2a', '#5a5a5e', '#2e4a6e', '#c9b78e', '#3a3a2a']
const SCARVES = ['#1d1c1f', '#5a3a7a', '#2f5fa8', '#7a2a3a', '#2e7d5b', '#c9b78e', '#d86a8a', '#1f2a44', '#e0a020', '#efe8d6']
const isHijab = computed(() => look.dress === 'traditional' && look.body === 'woman')
const EXTRAS = [
  { id: 'cap', label: '🧢 Cap' },
  { id: 'kufi', label: '🕌 Kufi' },
  { id: 'gele', label: '👑 Gele' },
  { id: 'sunglasses', label: '🕶️ Shades' },
  { id: 'headphones', label: '🎧 Headphones' },
  { id: 'watch', label: '⌚ Watch' },
  { id: 'backpack', label: '🎒 Backpack' },
  { id: 'phone', label: '📱 Phone' }
]

const look = reactive({
  body: (sim.look?.body ?? 'man') as 'man' | 'woman',
  dress: ((sim.look as any)?.dress ?? (sim.look?.outfit === 'kaftan' || sim.look?.outfit === 'dress' ? 'traditional' : 'modern')) as 'modern' | 'traditional',
  skin: sim.look?.skin ?? '#6e4630',
  hairColor: sim.look?.hairColor ?? '#141114',
  top: sim.look?.top ?? '#2e7d5b',
  bottom: sim.look?.bottom ?? '#2b3440',
  print: Number((sim.look as any)?.print ?? 0),
  gadgets: [...(sim.look?.gadgets ?? [])] as string[]
})
const canvas = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const tab = ref<'body' | 'clothes' | 'extras'>('body')
let engine: Engine | null = null
let scene: Scene | null = null
let charRoot: AbstractMesh | null = null
let skinned: Mesh | null = null
let base: BaseInfo | null = null
let dyeTex: DynamicTexture | null = null
let anim: AnimationGroup | null = null
const gadgetNodes: TransformNode[] = []

async function loadBody() {
  if (!scene) return
  loading.value = true
  anim?.dispose()
  charRoot?.dispose(false, true)
  gadgetNodes.length = 0
  base = null
  const file = look.dress === 'traditional' ? (look.body === 'woman' ? 'hijab_female.glb' : 'caftan_male.glb') : look.body === 'woman' ? 'african_female.glb' : 'african_male.glb'
  const res = await SceneLoader.ImportMeshAsync('', '/models/mixamo/', file, scene)
  charRoot = res.meshes[0]!
  skinned = res.meshes.find((m) => (m as Mesh).skeleton && m.getTotalVertices() > 0) as Mesh
  // normalise to 1.8 m tall, feet on the floor
  charRoot.computeWorldMatrix(true)
  const { min, max } = charRoot.getHierarchyBoundingVectors(true)
  const h = max.y - min.y || 1
  const k = (look.body === 'woman' ? 1.7 : 1.8) / h
  charRoot.scaling.scaleInPlace(k)
  charRoot.computeWorldMatrix(true)
  const b2 = charRoot.getHierarchyBoundingVectors(true)
  charRoot.position.y -= b2.min.y
  for (const m of res.meshes) shadowGen?.addShadowCaster(m, true)
  // idle animation retargeted by bone name (hips translation dropped: the
  // clip is authored in a different scale)
  try {
    const cont = await SceneLoader.LoadAssetContainerAsync('/models/mixamo/anims/', 'idle.glb', scene)
    const src = cont.animationGroups[0]
    if (src) {
      const strip = (n: string) => n.replace(/^mixamorig:?/, '')
      const nodes = new Map<string, any>()
      for (const t of scene.transformNodes) nodes.set(strip(t.name), t)
      const ag = src.clone('idle', (old: any) => nodes.get(strip(old.name)) ?? null)
      for (const ta of [...ag.targetedAnimations]) if (!ta.target || ta.animation.targetProperty === 'position' || ta.animation.targetProperty === 'scaling') ag.removeTargetedAnimation(ta.animation)
      ag.start(true)
      anim = ag
    }
    cont.dispose()
  } catch (e) {
    console.warn('idle anim', e)
  }
  // re-measure from the posed skeleton (some rigs carry an armature scale
  // that the bind-pose mesh bounds don't show): head bone ~ 92% of height
  scene.render()
  const head = scene.transformNodes.find((t) => /Head$/.test(t.name) && !/HeadTop/.test(t.name))
  const foot = scene.transformNodes.find((t) => /LeftToeBase$|LeftFoot$/.test(t.name))
  if (head && foot && charRoot) {
    head.computeWorldMatrix(true)
    foot.computeWorldMatrix(true)
    const hy = head.getAbsolutePosition().y - foot.getAbsolutePosition().y
    const want = (look.body === 'woman' ? 1.66 : 1.78) * 0.86
    if (hy > 0.01 && Math.abs(hy / want - 1) > 0.05) charRoot.scaling.scaleInPlace(want / hy)
    scene.render()
    foot.computeWorldMatrix(true)
    // feet on the floor (ankle bone ~8 cm up)
    charRoot.position.y -= foot.getAbsolutePosition().y - 0.08
  }
  // base texture -> region labels (same algorithm as the city wardrobe)
  const mat = skinned?.material as PBRMaterial | StandardMaterial | null
  // the original texture straight out of the .glb (glTF orientation, the
  // same space as the mesh UVs) - no GPU read-back flips to worry about
  const raw = await glbData('/models/mixamo/' + file)
  if (skinned && mat && raw) {
    base = buildBaseFrom(raw.md, raw.img as any, look.dress === 'traditional' && look.body === 'woman')
    dyeTex = new DynamicTexture('dye', { width: 1024, height: 1024 }, scene, true, Texture.TRILINEAR_SAMPLINGMODE, undefined, true)
    dyeTex.hasAlpha = false
    ;(mat as any).albedoTexture = dyeTex
    ;(mat as any).diffuseTexture = dyeTex
  }
  redye()
  buildGadgets()
  loading.value = false
}

/** Read the texture AND the skinned mesh data straight from the .glb, so the
 *  region labels use exactly the same data as the city (three.js) does. */
async function glbData(url: string): Promise<{ img: ImageBitmap; md: MeshData } | null> {
  try {
    const buf = await (await fetch(url)).arrayBuffer()
    const dv = new DataView(buf)
    const jsonLen = dv.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)))
    const bin = 20 + jsonLen + 8
    const im = json.images?.[0]
    if (!im) return null
    const view = (bvI: number) => json.bufferViews[bvI]
    const bytes = (bvI: number) => {
      const bv = view(bvI)
      return new Uint8Array(buf, bin + (bv.byteOffset ?? 0), bv.byteLength)
    }
    const img = await createImageBitmap(new Blob([bytes(im.bufferView)], { type: im.mimeType ?? 'image/png' }))
    const CT: Record<number, any> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }
    const NC: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
    const acc = (i: number) => {
      const a = json.accessors[i]
      const bv = view(a.bufferView)
      const T = CT[a.componentType]
      const n = NC[a.type]!
      const stride = bv.byteStride ? bv.byteStride / T.BYTES_PER_ELEMENT : n
      const arr = new T(buf, bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), (a.count - 1) * stride + n)
      return { get: (k: number, c: number) => arr[k * stride + c] as number, count: a.count as number, norm: a.normalized as boolean, type: a.componentType as number }
    }
    // the biggest skinned primitive
    const meshIdx = json.nodes.findIndex((n: any) => n.mesh !== undefined && n.skin !== undefined)
    const node = json.nodes[meshIdx]
    const prim = json.meshes[node.mesh].primitives.sort((x: any, y: any) => json.accessors[y.attributes.POSITION].count - json.accessors[x.attributes.POSITION].count)[0]
    const uv = acc(prim.attributes.TEXCOORD_0)
    const J = acc(prim.attributes.JOINTS_0)
    const Wt = acc(prim.attributes.WEIGHTS_0)
    const I = prim.indices !== undefined ? acc(prim.indices) : null
    const boneNames = json.skins[node.skin].joints.map((j: number) => json.nodes[j].name as string)
    const uvScale = uv.type === 5126 ? 1 : uv.type === 5121 ? 1 / 255 : 1 / 65535
    const wScale = Wt.type === 5126 ? 1 : Wt.type === 5121 ? 1 / 255 : 1 / 65535
    const md: MeshData = {
      count: uv.count,
      uv: (i) => [uv.get(i, 0) * uvScale, uv.get(i, 1) * uvScale],
      topBone: (i) => {
        let best = 0
        let bw = -1
        for (let k = 0; k < 4; k++) {
          const w = Wt.get(i, k) * wScale
          if (w > bw) (bw = w), (best = J.get(i, k))
        }
        return best
      },
      index: I ? (n) => I.get(n, 0) : null,
      triCount: I ? I.count / 3 : uv.count / 3,
      boneNames
    }
    return { img, md }
  } catch (e) {
    console.warn('glb parse', e)
    return null
  }
}

function redye() {
  if (!base || !dyeTex) return
  // a kaftan is one cloth top to bottom
  const bottom = look.dress === 'traditional' ? look.top : look.bottom
  const cv = dressCanvas(base, { skin: look.skin, top: look.top, bottom, hair: look.hairColor, print: look.print })
  const ctx = dyeTex.getContext() as CanvasRenderingContext2D
  ctx.drawImage(cv, 0, 0, 1024, 1024)
  dyeTex.update(false)
}

// ---- extras: simple props parented to the head / hand / spine bones
function boneNode(name: RegExp): TransformNode | null {
  if (!scene) return null
  return (scene.transformNodes.find((t) => name.test(t.name)) as TransformNode) ?? null
}
function buildGadgets() {
  if (!scene) return
  for (const n of gadgetNodes) n.dispose()
  gadgetNodes.length = 0
  const head = boneNode(/Head$/)
  const hand = boneNode(/RightHand$/)
  const spine = boneNode(/Spine2$|Spine1$/)
  const arm = boneNode(/LeftForeArm$/)
  const m = (c: string, metal = false) => {
    const mm = new StandardMaterial('g' + c, scene!)
    mm.diffuseColor = Color3.FromHexString(c)
    mm.specularColor = metal ? new Color3(0.6, 0.6, 0.6) : new Color3(0.08, 0.08, 0.08)
    return mm
  }
  // the bones are in the model's own (cm-ish) units: size props in metres
  // and divide by the bone's world scale
  const attach = (parent: TransformNode | null, mesh: Mesh, pos: [number, number, number]) => {
    if (!parent) return mesh.dispose()
    parent.computeWorldMatrix(true)
    const s = parent.absoluteScaling.y || 1
    const holder = new TransformNode('gad', scene!)
    holder.parent = parent
    holder.scaling.setAll(1 / s)
    holder.position = new Vector3(pos[0] / s, pos[1] / s, pos[2] / s)
    mesh.parent = holder
    shadowGen?.addShadowCaster(mesh)
    gadgetNodes.push(holder)
  }
  for (const gid of look.gadgets) {
    if (gid === 'cap') {
      const c = MeshBuilder.CreateSphere('cap', { diameter: 0.21, slice: 0.5 }, scene)
      c.material = m('#c0392b')
      const brim = MeshBuilder.CreateCylinder('brim', { diameter: 0.14, height: 0.01 }, scene)
      brim.position = new Vector3(0, 0, 0.09)
      brim.parent = c
      brim.material = c.material
      attach(head, c, [0, 0.13, 0.01])
    } else if (gid === 'kufi') {
      const c = MeshBuilder.CreateCylinder('kufi', { diameter: 0.2, height: 0.08 }, scene)
      c.material = m('#efe8d6')
      attach(head, c, [0, 0.15, 0])
    } else if (gid === 'gele') {
      const c = MeshBuilder.CreateTorusKnot('gele', { radius: 0.09, tube: 0.03, radialSegments: 48, p: 2, q: 3 }, scene)
      c.material = m('#d4a017')
      attach(head, c, [0, 0.17, -0.02])
    } else if (gid === 'sunglasses') {
      const c = MeshBuilder.CreateBox('shades', { width: 0.16, height: 0.04, depth: 0.02 }, scene)
      c.material = m('#111111', true)
      attach(head, c, [0, 0.08, 0.1])
    } else if (gid === 'headphones') {
      const c = MeshBuilder.CreateTorus('hp', { diameter: 0.21, thickness: 0.02, tessellation: 24 }, scene)
      c.rotation.z = Math.PI / 2
      c.material = m('#222222')
      attach(head, c, [0, 0.1, 0])
    } else if (gid === 'watch') {
      const c = MeshBuilder.CreateTorus('w', { diameter: 0.07, thickness: 0.02 }, scene)
      c.material = m('#c9a227', true)
      attach(arm, c, [0, 0.24, 0])
    } else if (gid === 'backpack') {
      const c = MeshBuilder.CreateBox('bp', { width: 0.3, height: 0.38, depth: 0.14 }, scene)
      c.material = m('#2f5fa8')
      attach(spine, c, [0, 0, -0.17])
    } else if (gid === 'phone') {
      const c = MeshBuilder.CreateBox('ph', { width: 0.07, height: 0.14, depth: 0.01 }, scene)
      c.material = m('#101010', true)
      attach(hand, c, [0, 0.08, 0.03])
    }
  }
}

let shadowGen: ShadowGenerator | null = null
onMounted(async () => {
  engine = new Engine(canvas.value!, true, { preserveDrawingBuffer: true })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.09, 0.08, 0.12, 1)
  const cam = new ArcRotateCamera('cam', -Math.PI / 2, 1.3, 3.8, new Vector3(0, 0.6, 0), scene)
  cam.attachControl(canvas.value!, true)
  cam.lowerRadiusLimit = 1.2
  cam.upperRadiusLimit = 6
  cam.wheelPrecision = 60
  cam.useAutoRotationBehavior = true
  cam.autoRotationBehavior!.idleRotationSpeed = 0.25
  // studio lighting: soft sky fill, warm key with soft shadows, cool rim
  const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene)
  fill.intensity = 0.55
  fill.groundColor = new Color3(0.25, 0.2, 0.2)
  const key = new DirectionalLight('key', new Vector3(-0.5, -0.9, 0.6), scene)
  key.position = new Vector3(3, 6, -4)
  key.intensity = 1.4
  key.diffuse = new Color3(1, 0.92, 0.82)
  const rim = new SpotLight('rim', new Vector3(0, 2.4, 2.2), new Vector3(0, -0.5, -1), 1.2, 2, scene)
  rim.intensity = 3
  rim.diffuse = new Color3(0.6, 0.75, 1)
  shadowGen = new ShadowGenerator(1024, key)
  shadowGen.useBlurExponentialShadowMap = true
  shadowGen.blurKernel = 24
  const floor = MeshBuilder.CreateDisc('floor', { radius: 2.2, tessellation: 64 }, scene)
  floor.rotation.x = Math.PI / 2
  const fm = new StandardMaterial('floor', scene)
  fm.diffuseColor = Color3.FromHexString('#2a2433')
  fm.specularColor = new Color3(0.15, 0.15, 0.15)
  floor.material = fm
  floor.receiveShadows = true
  const ring = MeshBuilder.CreateTorus('ring', { diameter: 4.4, thickness: 0.03, tessellation: 96 }, scene)
  const rm = new StandardMaterial('ring', scene)
  rm.emissiveColor = Color3.FromHexString('#f39c12')
  ring.material = rm
  engine.runRenderLoop(() => scene!.render())
  window.addEventListener('resize', onResize)
  await loadBody()
  ;(window as any).__kk_creator = { ready: () => !loading.value && !!base, look, dbg: () => ({ head: scene!.transformNodes.filter((t) => /Head$|LeftFoot$|Hips$/.test(t.name)).map((t) => [t.name, t.getAbsolutePosition().asArray().map((v) => +v.toFixed(2))]), sk: scene!.meshes.map((m) => [m.name, m.getBoundingInfo().boundingBox.maximumWorld.y.toFixed(2)]), meshes: scene!.meshes.length, root: charRoot?.position.asArray(), scale: charRoot?.scaling.asArray(), anim: anim?.targetedAnimations.length, bb: charRoot?.getHierarchyBoundingVectors(true) }) }
})
function onResize() {
  engine?.resize()
}
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  engine?.dispose()
})

watch(() => [look.skin, look.top, look.bottom, look.hairColor, look.print], redye)
watch(() => [look.body, look.dress], loadBody)
watch(() => look.gadgets.join(','), buildGadgets)
function toggle(id: string) {
  const i = look.gadgets.indexOf(id)
  if (i >= 0) look.gadgets.splice(i, 1)
  else look.gadgets.push(id)
}
function randomise() {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!
  look.skin = pick(SKINS)
  look.top = pick(TOPS)
  look.bottom = pick(BOTTOMS)
  look.hairColor = pick(HAIR)
  look.print = Math.random() < 0.4 ? 0.6 : 0
}
function save() {
  const cur = (sim.look ?? {}) as any
  sim.look = { ...cur, dress: look.dress, outfit: look.dress === 'traditional' ? (look.body === 'woman' ? 'dress' : 'kaftan') : 'shirt', body: look.body, skin: look.skin, hairColor: look.hairColor, top: look.top, bottom: look.bottom, gadgets: [...look.gadgets], print: look.print } as any
  sim.created = true
  sim.save()
  navigateTo('/game')
}
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#17141f] text-white">
    <canvas ref="canvas" class="absolute inset-0 h-full w-full touch-none outline-none" />
    <div class="pointer-events-none absolute inset-x-0 top-3 flex items-center justify-between px-4">
      <div class="pointer-events-auto">
        <div class="font-display text-xl font-semibold">Character Studio</div>
        <div class="text-xs text-white/60">Drag to turn · scroll to zoom</div>
      </div>
      <div class="pointer-events-auto flex gap-2">
        <NuxtLink to="/game" class="rounded-full bg-white/10 px-4 py-2 text-sm font-bold">Cancel</NuxtLink>
        <button class="rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-ink" @click="save">Save & play</button>
      </div>
    </div>
    <div v-if="loading" class="absolute left-1/2 top-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-sm">Loading your character…</div>
    <div class="absolute bottom-3 left-1/2 w-[min(560px,94vw)] -translate-x-1/2 rounded-3xl bg-black/55 p-3 backdrop-blur">
      <div class="mb-2 flex gap-1 text-xs font-bold">
        <button v-for="t in (['body', 'clothes', 'extras'] as const)" :key="t" class="flex-1 rounded-full py-1.5 capitalize" :class="tab === t ? 'bg-white text-ink' : 'bg-white/10'" @click="tab = t">{{ t }}</button>
        <button class="rounded-full bg-white/10 px-3" title="Surprise me" @click="randomise">🎲</button>
      </div>
      <div v-if="tab === 'body'" class="space-y-2">
        <div class="flex gap-2">
          <button class="flex-1 rounded-xl py-2 text-sm font-bold" :class="look.body === 'man' ? 'bg-amber-500 text-ink' : 'bg-white/10'" @click="look.body = 'man'">Man</button>
          <button class="flex-1 rounded-xl py-2 text-sm font-bold" :class="look.body === 'woman' ? 'bg-amber-500 text-ink' : 'bg-white/10'" @click="look.body = 'woman'">Woman</button>
        </div>
        <div class="flex gap-2">
          <button class="flex-1 rounded-xl py-2 text-sm font-bold" :class="look.dress === 'modern' ? 'bg-amber-500 text-ink' : 'bg-white/10'" @click="look.dress = 'modern'">{{ look.body === 'woman' ? 'Blouse & trousers' : 'Shirt & trousers' }}</button>
          <button class="flex-1 rounded-xl py-2 text-sm font-bold" :class="look.dress === 'traditional' ? 'bg-amber-500 text-ink' : 'bg-white/10'" @click="look.dress = 'traditional'">{{ look.body === 'woman' ? 'Gown & hijab' : 'Kaftan' }}</button>
        </div>
        <div class="text-[11px] text-white/60">Skin</div>
        <div class="flex flex-wrap gap-1.5"><button v-for="c in SKINS" :key="c" class="h-8 w-8 rounded-full border-2" :class="look.skin === c ? 'border-amber-400' : 'border-transparent'" :style="{ background: c }" @click="look.skin = c" /></div>
        <div class="text-[11px] text-white/60">{{ isHijab ? 'Hijab' : 'Hair' }}</div>
        <div class="flex flex-wrap gap-1.5"><button v-for="c in (isHijab ? SCARVES : HAIR)" :key="c" class="h-7 w-7 rounded-full border-2" :class="look.hairColor === c ? 'border-amber-400' : 'border-transparent'" :style="{ background: c }" @click="look.hairColor = c" /></div>
      </div>
      <div v-else-if="tab === 'clothes'" class="space-y-2">
        <div class="text-[11px] text-white/60">Top</div>
        <div class="flex flex-wrap gap-1.5"><button v-for="c in TOPS" :key="c" class="h-7 w-7 rounded-lg border-2" :class="look.top === c ? 'border-amber-400' : 'border-transparent'" :style="{ background: c }" @click="look.top = c" /></div>
        <div class="text-[11px] text-white/60">Bottom</div>
        <div class="flex flex-wrap gap-1.5"><button v-for="c in BOTTOMS" :key="c" class="h-7 w-7 rounded-lg border-2" :class="look.bottom === c ? 'border-amber-400' : 'border-transparent'" :style="{ background: c }" @click="look.bottom = c" /></div>
        <label class="flex items-center gap-2 text-[11px] text-white/70">Ankara print <input v-model.number="look.print" type="range" min="0" max="1" step="0.1" class="flex-1" /></label>
      </div>
      <div v-else class="flex flex-wrap gap-1.5">
        <button v-for="g in EXTRAS" :key="g.id" class="rounded-full px-3 py-1.5 text-xs font-bold" :class="look.gadgets.includes(g.id) ? 'bg-amber-500 text-ink' : 'bg-white/10'" @click="toggle(g.id)">{{ g.label }}</button>
      </div>
    </div>
  </div>
</template>
