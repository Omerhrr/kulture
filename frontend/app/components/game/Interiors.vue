<script setup lang="ts">
// Interiors - open houses you can walk into. Each open house gets an open
// door, a doormat and a full furnished room directly below its footprint
// (same x/z, 60 units down), so walking through the door never teleports:
// the server just sees you standing at the house. Rooms have a living room
// (sofa, TV, coffee table, dining set), a bedroom (bed, wardrobe, lamp), a
// kitchenette and a bathroom (toilet, sink, shower).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OPEN_HOUSES, INTERIOR_DROP, doorFront, type OpenHouse } from '~/utils/kadunaExtras'
import { setInteriorWalls, type Box } from '~/utils/collision'
import { makeLabelTexture } from '~/utils/sign'
import { useInterior, useDoorPrompt, useRide, useCamOrbit } from '~/composables/useControlsState'

const ride = useRide()
const interior = useInterior()
const doorPrompt = useDoorPrompt()
const orbit = useCamOrbit()
const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])

interface Room {
  house: OpenHouse
  group: THREE.Group | null
  light: THREE.PointLight | null
  fill: THREE.PointLight | null
  walls: Box[]
  rot: number
  W: number
  D: number
}

const rooms: Room[] = []
const groupRef = ref<THREE.Group | null>(null)

// ---------------------------------------------------------------- geometry
function push(parts: Array<[string, THREE.BufferGeometry]>, hex: string, g: THREE.BufferGeometry) {
  parts.push([hex, g])
}
const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}
const cylAt = (rt: number, rb: number, h: number, x: number, y: number, z: number) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, 10)
  g.translate(x, y, z)
  return g
}
const coneAt = (r: number, h: number, x: number, y: number, z: number) => {
  const g = new THREE.ConeGeometry(r, h, 10)
  g.translate(x, y, z)
  return g
}
const sphereAt = (r: number, x: number, y: number, z: number) => {
  const g = new THREE.SphereGeometry(r, 10, 8)
  g.translate(x, y, z)
  return g
}

function merge(parts: Array<[string, THREE.BufferGeometry]>): THREE.BufferGeometry {
  const geos = parts.map(([hex, g]) => {
    const gg = g.index ? g.toNonIndexed() : g
    if (gg !== g) g.dispose()
    gg.deleteAttribute('uv')
    const c = new THREE.Color(hex)
    const n = gg.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    gg.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return gg
  })
  const merged = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  return merged ?? new THREE.BufferGeometry()
}

/** Furnished room shell + furniture in local space (door at +z edge). */
function buildRoom(W: number, D: number): THREE.BufferGeometry {
  const parts: Array<[string, THREE.BufferGeometry]> = []
  const wallH = 3.0
  const t = 0.3

  // floor + ceiling
  push(parts, '#b8a888', bx(W, 0.2, D, 0, -0.1, 0))
  push(parts, '#e8e4d8', bx(W + 0.4, 0.2, D + 0.4, 0, wallH + 0.1, 0))
  // ceiling lamp fixture hangs in the middle
  push(parts, '#3a2a1a', cylAt(0.03, 0.03, 0.5, 0, wallH - 0.15, 0))
  push(parts, '#ffe9b8', coneAt(0.34, 0.3, 0, wallH - 0.42, 0))

  // outer walls, door gap (1.8) centered on the +z edge
  push(parts, '#e2d6c0', bx(W, wallH, t, 0, wallH / 2, -D / 2)) // back
  push(parts, '#e2d6c0', bx(t, wallH, D, -W / 2, wallH / 2, 0)) // left
  push(parts, '#e2d6c0', bx(t, wallH, D, W / 2, wallH / 2, 0)) // right
  const segW = (W - 1.8) / 2
  push(parts, '#e2d6c0', bx(segW, wallH, t, -(1.8 / 2 + segW / 2), wallH / 2, D / 2))
  push(parts, '#e2d6c0', bx(segW, wallH, t, 1.8 / 2 + segW / 2, wallH / 2, D / 2))
  // lintel over the door
  push(parts, '#e2d6c0', bx(1.8, wallH - 2.2, t, 0, 2.2 + (wallH - 2.2) / 2, D / 2))

  // curtained windows on the left wall (warm glow panels inside)
  push(parts, '#fff3d0', bx(0.06, 1.1, 1.3, -W / 2 + t / 2 + 0.02, 1.7, -0.4))
  push(parts, '#c47a52', bx(0.1, 1.25, 1.5, -W / 2 + t / 2 + 0.08, 1.7, -0.4))
  push(parts, '#fff3d0', bx(0.06, 1.1, 1.3, W / 2 - t / 2 - 0.02, 1.7, 1.2))
  push(parts, '#3f6fae', bx(0.1, 1.25, 1.5, W / 2 - t / 2 - 0.08, 1.7, 1.2))

  // enclosed yard outside the door so the view out is a real place
  const yard = 26
  push(parts, '#7a8a56', bx(yard, 0.16, yard, 0, -0.14, D / 2 + yard / 2))
  push(parts, '#a89a7a', bx(3.2, 0.14, 2.4, 0, -0.03, D / 2 + 1.9)) // front steps
  // low compound wall flanking the yard, open toward the street
  const fy = D / 2 + yard - 0.6
  push(parts, '#c8c2b2', bx(yard, 1.5, 0.35, 0, 0.6, fy))
  push(parts, '#c8c2b2', bx(0.35, 1.5, yard, -yard / 2 + 0.2, 0.6, D / 2 + yard / 2))
  push(parts, '#c8c2b2', bx(0.35, 1.5, yard, yard / 2 - 0.2, 0.6, D / 2 + yard / 2))
  // a neem tree + clothesline in the yard
  push(parts, '#7a5c3a', cylAt(0.14, 0.22, 2.6, -5.5, 1.2, D / 2 + 5))
  push(parts, '#4f7d3f', sphereAt(1.5, -5.5, 3.1, D / 2 + 5))
  push(parts, '#6b4a2f', cylAt(0.05, 0.05, 0.05, 3.2, 1.6, D / 2 + 4))
  push(parts, '#d8d8d0', bx(1.1, 0.02, 0.7, 2.7, 1.52, D / 2 + 4.2))

  // bedroom partition (back-left corner)
  const bz = -D / 2 + 4.4
  const bxx = -W / 2 + 4.4
  push(parts, '#d8cbb2', bx(4.4, 2.6, t, -W / 2 + 2.2, 1.3, bz))
  push(parts, '#d8cbb2', bx(t, 2.6, 4.4, bxx, 1.3, -D / 2 + 2.2))
  // bathroom (back-right corner)
  const bz2 = -D / 2 + 3.2
  const bxx2 = W / 2 - 3.4
  push(parts, '#cfd8da', bx(3.4, 2.5, t, W / 2 - 1.7, 1.25, bz2))
  push(parts, '#cfd8da', bx(t, 2.5, 3.2, bxx2, 1.25, -D / 2 + 1.6))

  // ---- living room: sofa + TV + coffee table + rug (center right)
  push(parts, '#b04a3a', bx(3.2, 0.04, 2.2, W / 2 - 3.6, 0.03, 0.6)) // rug
  push(parts, '#4a6a8a', bx(0.9, 0.5, 2.4, W / 2 - 4.4, 0.35, 0.6)) // sofa seat
  push(parts, '#4a6a8a', bx(0.25, 0.75, 2.4, W / 2 - 4.85, 0.55, 0.6)) // sofa back
  push(parts, '#415c7a', bx(0.9, 0.55, 0.25, W / 2 - 4.4, 0.5, -0.55)) // sofa arm
  push(parts, '#415c7a', bx(0.9, 0.55, 0.25, W / 2 - 4.4, 0.5, 1.75)) // sofa arm
  push(parts, '#6a8aa8', bx(0.7, 0.18, 0.9, W / 2 - 4.5, 0.68, 0.15)) // cushion
  push(parts, '#6a8aa8', bx(0.7, 0.18, 0.9, W / 2 - 4.5, 0.68, 1.15)) // cushion
  push(parts, '#3a2f1c', bx(1.0, 0.09, 0.7, W / 2 - 2.9, 0.5, 0.6)) // coffee table
  push(parts, '#3a2f1c', cylAt(0.06, 0.06, 0.45, W / 2 - 3.15, 0.25, 0.4))
  push(parts, '#3a2f1c', cylAt(0.06, 0.06, 0.45, W / 2 - 2.65, 0.25, 0.8))
  push(parts, '#2b2e34', bx(1.5, 0.5, 0.45, W / 2 - 0.7, 0.35, 0.6)) // TV stand
  push(parts, '#1a2a35', bx(0.1, 0.9, 1.6, W / 2 - 0.55, 1.15, 0.6)) // TV (faces sofa)
  push(parts, '#3a7d95', bx(0.04, 0.78, 1.45, W / 2 - 0.5, 1.15, 0.6)) // glowing screen

  // ---- dining set near the entry
  push(parts, '#6b4a2f', bx(1.5, 0.09, 0.9, -0.6, 0.76, D / 2 - 2.0))
  push(parts, '#6b4a2f', cylAt(0.07, 0.07, 0.72, -1.2, 0.36, D / 2 - 2.3))
  push(parts, '#6b4a2f', cylAt(0.07, 0.07, 0.72, 0.0, 0.36, D / 2 - 2.3))
  for (const [dx, dz] of [[-1.2, -1.5], [0, -1.5], [-1.2, -2.5], [0, -2.5]] as const) {
    push(parts, '#8a5a3a', bx(0.4, 0.45, 0.4, dx, 0.22, D / 2 + dz))
  }

  // ---- kitchenette along the left wall
  push(parts, '#c8c4b8', bx(0.6, 0.85, 3.2, -W / 2 + 0.35, 0.52, 2.6))
  push(parts, '#8a8f96', bx(0.62, 0.06, 0.7, -W / 2 + 0.35, 0.97, 1.7)) // stove
  push(parts, '#3a3f46', cylAt(0.12, 0.12, 0.14, -W / 2 + 0.35, 1.08, 1.55)) // pot
  push(parts, '#d8dce2', bx(0.7, 1.75, 0.68, -W / 2 + 0.4, 0.98, 4.2)) // fridge
  push(parts, '#b8bcc4', bx(0.06, 0.5, 0.05, -W / 2 + 0.75, 1.35, 4.2)) // handle

  // ---- bedroom furniture
  push(parts, '#6b4a2f', bx(1.6, 0.3, 2.2, -W / 2 + 1.1, 0.25, -D / 2 + 1.3)) // bed frame
  push(parts, '#e8e4d8', bx(1.45, 0.2, 2.05, -W / 2 + 1.1, 0.5, -D / 2 + 1.3)) // mattress
  push(parts, '#f2ede0', bx(0.55, 0.14, 0.35, -W / 2 + 1.1, 0.64, -D / 2 + 0.5)) // pillow
  push(parts, '#3f7d5b', bx(1.47, 0.08, 1.2, -W / 2 + 1.1, 0.62, -D / 2 + 1.7)) // blanket
  push(parts, '#5a3f2a', bx(1.1, 1.9, 0.5, -W / 2 + 3.4, 1.05, -D / 2 + 0.45)) // wardrobe
  push(parts, '#3a2f1c', cylAt(0.05, 0.05, 1.3, bxx + 0.5, 0.75, bz - 0.5)) // lamp pole
  push(parts, '#e8c84b', cylAt(0.16, 0.24, 0.25, bxx + 0.5, 1.5, bz - 0.5)) // lamp shade

  // ---- bathroom fixtures
  push(parts, '#f2f2ee', bx(0.42, 0.4, 0.55, W / 2 - 0.65, 0.3, -D / 2 + 0.75)) // wc base
  push(parts, '#f2f2ee', bx(0.42, 0.55, 0.18, W / 2 - 0.65, 0.75, -D / 2 + 0.45)) // wc tank
  push(parts, '#f2f2ee', cylAt(0.22, 0.17, 0.12, W / 2 - 0.65, 0.55, -D / 2 + 0.75)) // seat
  push(parts, '#f2f2ee', cylAt(0.26, 0.2, 0.5, W / 2 - 0.75, 0.55, -D / 2 + 2.2)) // sink
  push(parts, '#dfeef2', bx(0.9, 0.08, 0.9, W / 2 - 1.7, 0.1, -D / 2 + 2.6)) // shower tray
  push(parts, '#8a8f96', bx(0.06, 0.5, 0.2, W / 2 - 1.7, 2.2, -D / 2 + 2.95)) // shower arm
  push(parts, '#8a8f96', bx(0.18, 0.06, 0.18, W / 2 - 1.7, 2.0, -D / 2 + 2.7)) // shower head

  // ---- plant + wall art
  push(parts, '#b86a2a', cylAt(0.22, 0.16, 0.35, -W / 2 + 1.2, 0.28, D / 2 - 0.9))
  push(parts, '#4f8f3f', new THREE.SphereGeometry(0.34, 9, 7).translate(-W / 2 + 1.2, 0.62, D / 2 - 0.9))
  push(parts, '#c47a52', bx(0.9, 0.6, 0.05, 0, 1.9, -D / 2 + t / 2 + 0.02))

  return merge(parts)
}

/** Open door + mat + awning + sign in world space at the house entrance. */
function buildDoorway(h: OpenHouse): { geo: THREE.BufferGeometry; sign: THREE.CanvasTexture } {
  const parts: Array<[string, THREE.BufferGeometry]> = []
  const off = (h.nz !== 0 ? h.d / 2 : h.w / 2) + 0.02
  // open door leaf, swung outward on the right hinge
  const leaf = new THREE.BoxGeometry(1.0, 2.15, 0.07)
  leaf.translate(0.5 + 0.75, 0, 0.55)
  leaf.rotateY(-1.15)
  leaf.translate(0, 1.08, off)
  push(parts, '#4a3524', leaf)
  // frame
  push(parts, '#3a2a1a', bx(0.12, 2.3, 0.14, -0.95, 1.15, off))
  push(parts, '#3a2a1a', bx(0.12, 2.3, 0.14, 0.95, 1.15, off))
  // doormat
  push(parts, '#8a6a4a', bx(1.4, 0.05, 0.8, 0, 0.03, off + 0.7))
  // awning + posts
  push(parts, '#c94a3a', bx(2.6, 0.1, 1.3, 0, 2.55, off + 0.5))
  push(parts, '#6b4a2f', cylAt(0.06, 0.07, 2.5, -1.15, 1.25, off + 0.95))
  push(parts, '#6b4a2f', cylAt(0.06, 0.07, 2.5, 1.15, 1.25, off + 0.95))
  return { geo: merge(parts), sign: makeLabelTexture(h.name.toUpperCase(), '#ffe9a8') }
}

// ---------------------------------------------------------------- colliders
function roomWalls(h: OpenHouse): Box[] {
  // local room frame: door on +z, W across, D deep; then rotate to the
  // door side (rotations are cardinal so AABBs stay axis-aligned)
  const rot = Math.atan2(h.nx, h.nz) // 0, PI, +/-PI/2
  const W = h.nz !== 0 ? h.w : h.d
  const D = h.nz !== 0 ? h.d : h.w
  const out: Box[] = []
  const add = (lx: number, lz: number, lw: number, ld: number) => {
    const cos = Math.round(Math.cos(rot))
    const sin = Math.round(Math.sin(rot))
    const wx = lx * cos + lz * sin
    const wz = -lx * sin + lz * cos
    const ww = Math.abs(cos) > 0 ? lw : ld
    const wd = Math.abs(cos) > 0 ? ld : lw
    out.push({ x: h.x + wx, z: h.z + wz, w: ww, d: wd })
  }
  const t = 0.3
  add(0, -D / 2, W, t) // back
  add(-W / 2, 0, t, D)
  add(W / 2, 0, t, D)
  const segW = (W - 1.8) / 2
  add(-(1.8 / 2 + segW / 2), D / 2, segW, t)
  add(1.8 / 2 + segW / 2, D / 2, segW, t)
  // partitions
  add(-W / 2 + 2.2, -D / 2 + 4.4, 4.4, t)
  add(-W / 2 + 4.4, -D / 2 + 2.2, t, 4.4)
  add(W / 2 - 1.7, -D / 2 + 3.2, 3.4, t)
  add(W / 2 - 3.4, -D / 2 + 1.6, t, 3.2)
  // furniture that should block
  add(W / 2 - 4.4, 0.6, 1.0, 2.4) // sofa
  add(W / 2 - 0.7, 0.6, 0.5, 1.6) // TV
  add(-0.6, D / 2 - 2.0, 1.5, 0.9) // dining table
  add(-W / 2 + 0.35, 2.6, 0.7, 3.2) // kitchen counter
  add(-W / 2 + 0.4, 4.2, 0.8, 0.8) // fridge
  add(-W / 2 + 1.1, -D / 2 + 1.3, 1.7, 2.3) // bed
  add(-W / 2 + 3.4, -D / 2 + 0.45, 1.2, 0.6) // wardrobe
  return out
}

// ---------------------------------------------------------------- mount
const signs = ref<Array<{ tex: THREE.CanvasTexture; x: number; y: number; z: number }>>([])

onMounted(() => {
  const g = groupRef.value
  if (!g) return
  for (const h of OPEN_HOUSES) {
    const rot = Math.atan2(h.nx, h.nz)
    const W = h.nz !== 0 ? h.w : h.d
    const D = h.nz !== 0 ? h.d : h.w

    // furnished room below the footprint; DoubleSide so the walls are
    // solid when seen from inside (the isolation fix)
    const room = new THREE.Mesh(buildRoom(W, D), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))
    room.receiveShadow = false
    room.castShadow = false
    const holder = new THREE.Group()
    holder.add(room)
    holder.position.set(h.x, -INTERIOR_DROP, h.z)
    holder.rotation.y = rot
    g.add(holder)

    const light = new THREE.PointLight('#ffe8c8', 0, 34, 1.3)
    light.position.set(h.x, -INTERIOR_DROP + 2.5, h.z)
    g.add(light)
    const fill = new THREE.PointLight('#dff0ff', 0, 24, 1.6)
    fill.position.set(h.x - 2, -INTERIOR_DROP + 1.6, h.z + 2)
    g.add(fill)

    // doorway dressing in the street
    const dw = buildDoorway(h)
    const door = new THREE.Mesh(dw.geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
    door.castShadow = true
    const dHolder = new THREE.Group()
    dHolder.add(door)
    const [fx, fz] = doorFront(h)
    // doorway group origin sits at the wall face, door normal = local +z
    dHolder.position.set(h.x + h.nx * (h.nz !== 0 ? h.w / 2 : h.d / 2), 0, h.z + h.nz * (h.nz !== 0 ? h.d / 2 : h.w / 2))
    dHolder.rotation.y = rot
    g.add(dHolder)
    signs.value.push({ tex: dw.sign, x: fx + h.nx * 0.6, y: 3.4, z: fz + h.nz * 0.6 })

    rooms.push({ house: h, group: holder, light, fill, walls: roomWalls(h), rot, W, D })
  }
})

// ---------------------------------------------------------------- triggers
let scanTimer = 0
const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  scanTimer += delta || 0
  if (scanTimer < 0.18) return
  scanTimer = 0
  if (ride.value.active) {
    doorPrompt.value = null
    return
  }
  const px = playerPos.value[0]
  const pz = playerPos.value[2]
  if (!interior.value.inside) {
    let hit: number | null = null
    for (let i = 0; i < rooms.length; i++) {
      const [fx, fz] = doorFront(rooms[i].house)
      if (Math.hypot(px - fx, pz - fz) < 1.7) {
        hit = i
        break
      }
    }
    doorPrompt.value = hit === null ? null : { label: `Enter ${rooms[hit].house.name}`, action: 'enter', slot: hit }
  } else {
    const slot = rooms.findIndex((r) => r.house.name === interior.value.name)
    if (slot >= 0) {
      const [fx, fz] = doorFront(rooms[slot].house)
      doorPrompt.value =
        Math.hypot(px - fx, pz - fz) < 1.9 ? { label: 'Exit to the street', action: 'exit', slot } : null
    }
  }
})

function enter(slot: number) {
  const r = rooms[slot]
  if (!r) return
  setInteriorWalls(r.walls)
  interior.value = { inside: true, name: r.house.name }
  doorPrompt.value = null
  if (r.light) r.light.intensity = 1.35
  if (r.fill) r.fill.intensity = 0.5
  // step just inside the entry
  const cos = Math.round(Math.cos(r.rot))
  const sin = Math.round(Math.sin(r.rot))
  const lx = 0
  const lz = r.D / 2 - 1.3
  playerPos.value = [r.house.x + lx * cos + lz * sin, 0, r.house.z - lx * sin + lz * cos]
  // face into the room at a slight angle so the first view shows the
  // living room furniture, not just the far wall
  orbit.value.yaw = r.rot + Math.PI - 0.55
}

function exit(slot: number) {
  const r = rooms[slot]
  if (!r) return
  setInteriorWalls(null)
  interior.value = { inside: false, name: '' }
  doorPrompt.value = null
  if (r.light) r.light.intensity = 0
  if (r.fill) r.fill.intensity = 0
  const [fx, fz] = doorFront(r.house)
  playerPos.value = [fx + r.house.nx * 0.8, 0, fz + r.house.nz * 0.8]
}

onMounted(() => {
  window.addEventListener('kk-door-use', () => {
    const p = doorPrompt.value
    if (!p) return
    if (p.action === 'enter') enter(p.slot)
    else exit(p.slot)
  })
  if (import.meta.dev) {
    ;(window as any).__kk_doors = () =>
      rooms.map((r) => ({ name: r.house.name, door: doorFront(r.house).map((v) => +v.toFixed(1)) }))
    ;(window as any).__kk_interior = () => ({ ...interior.value, prompt: doorPrompt.value })
  }
})
</script>

<template>
  <TresGroup ref="groupRef">
    <TresSprite v-for="(s, i) in signs" :key="'sig' + i" :position="[s.x, s.y, s.z]" :scale="[9, 1.7, 1]">
      <TresSpriteMaterial :map="s.tex" :transparent="true" :depth-write="false" />
    </TresSprite>
  </TresGroup>
</template>
