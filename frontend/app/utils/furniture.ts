// Movable furniture for the player's home. Every item is built around its
// own origin, facing +z (its "front"), and can be placed at any (x, z) in
// the room with quarter-turn rotations. Items carry their own collision
// footprint and their own use-spots (sit, nap, sleep, eat, snack).
import * as THREE from 'three'
import { merge, box, rbox, cyl, sph, ankaraTex, screenTex, type Part, type Hotspot } from './interiorRoom'

export interface Placed {
  uid: string
  sku: string
  x: number
  z: number
  rot: number
}
export interface ItemDef {
  name: string
  /** footprint in local space (w along x, d along z) */
  w: number
  d: number
  solid: boolean
  build: () => THREE.Group
  spots?: Array<Omit<Hotspot, 'fx' | 'fz'> & { fx?: number; fz?: number }>
}

const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 })
const gmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 })
function group(P: Part[], G: Part[] = [], extra: THREE.Object3D[] = []): THREE.Group {
  const g = new THREE.Group()
  if (P.length) {
    const m = new THREE.Mesh(merge(P), vmat)
    m.castShadow = m.receiveShadow = true
    g.add(m)
  }
  if (G.length) {
    const m = new THREE.Mesh(merge(G), gmat)
    m.castShadow = m.receiveShadow = true
    g.add(m)
  }
  for (const o of extra) g.add(o)
  return g
}

const SOFA = '#7a3a3a'
const WOOD = '#6a4428'
const DARK = '#3a2a1a'

export const ITEMS: Record<string, ItemDef> = {
  sofa3: {
    name: 'Three-seat sofa',
    w: 2.6,
    d: 1.05,
    solid: true,
    build: () => {
      const P: Part[] = [
        [SOFA, rbox(2.4, 0.42, 0.95, 0, 0.29, 0, 0.08)],
        [SOFA, rbox(2.4, 0.75, 0.25, 0, 0.52, -0.42, 0.1)],
        [SOFA, rbox(0.22, 0.62, 0.9, -1.22, 0.4, 0, 0.08)],
        [SOFA, rbox(0.22, 0.62, 0.9, 1.22, 0.4, 0, 0.08)]
      ]
      for (let i = 0; i < 3; i++) {
        const x = -0.74 + i * 0.74
        P.push([SOFA, rbox(0.72, 0.16, 0.72, x, 0.58, 0.06, 0.06)])
        P.push([SOFA, rbox(0.7, 0.5, 0.18, x, 0.86, -0.27, 0.07)])
      }
      P.push(['#3f6a8a', rbox(0.36, 0.36, 0.12, -0.85, 0.86, -0.16, 0.06)])
      P.push(['#f2c12e', rbox(0.34, 0.34, 0.12, 0.8, 0.86, -0.16, 0.06)])
      for (const x of [-1.1, 1.1]) for (const z of [-0.38, 0.38]) P.push(['#2a1e14', cyl(0.025, 0.025, 0.1, x, 0.05, z, 6)])
      return group(P)
    },
    spots: [
      { id: 'tv', x: -0.55, z: 0.95, seat: { x: -0.55, z: 0.04, h: 0.44, yaw: 0 } },
      { id: 'sofa', x: 0.6, z: 0.95, seat: { x: 0, z: 0.02, h: 0.42, yaw: Math.PI / 2 } }
    ]
  },
  armchair: {
    name: 'Armchair',
    w: 0.95,
    d: 0.95,
    solid: true,
    build: () =>
      group([
        [SOFA, rbox(0.85, 0.4, 0.85, 0, 0.3, 0, 0.08)],
        [SOFA, rbox(0.85, 0.7, 0.2, 0, 0.55, -0.36, 0.08)],
        [SOFA, rbox(0.18, 0.55, 0.8, -0.38, 0.45, 0, 0.07)],
        [SOFA, rbox(0.18, 0.55, 0.8, 0.38, 0.45, 0, 0.07)],
        [SOFA, rbox(0.6, 0.14, 0.6, 0, 0.55, 0.04, 0.05)]
      ]),
    spots: [{ id: 'chair', x: 0, z: 0.95, seat: { x: 0, z: 0.05, h: 0.46, yaw: 0 } }]
  },
  coffee_table: {
    name: 'Glass coffee table',
    w: 1.35,
    d: 0.95,
    solid: true,
    build: () => {
      const P: Part[] = [[DARK, box(1.2, 0.02, 0.8, 0, 0.15, 0)]]
      for (const [x, z] of [[-0.58, -0.38], [0.58, -0.38], [-0.58, 0.38], [0.58, 0.38]]) P.push([DARK, box(0.05, 0.43, 0.05, x, 0.215, z)])
      P.push(['#c84a3a', sph(0.05, -0.3, 0.72, 0.02)])
      P.push(['#2f7d5b', box(0.3, 0.04, 0.22, 0.3, 0.47, -0.1)])
      return group(P, [['#bcd6dc', rbox(1.3, 0.03, 0.9, 0, 0.44, 0, 0.015)], ['#d8b13c', cyl(0.09, 0.06, 0.22, -0.3, 0.57, 0.02, 12)]])
    }
  },
  tv_console: {
    name: '43" TV + console',
    w: 2.3,
    d: 0.6,
    solid: true,
    build: () => {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 0.74), new THREE.MeshStandardMaterial({ map: screenTex(), emissive: '#ffffff', emissiveMap: screenTex(), emissiveIntensity: 0.8 }))
      screen.position.set(0, 1.3, 0.035)
      return group(
        [[WOOD, rbox(2.2, 0.5, 0.45, 0, 0.25, 0, 0.03)], [DARK, box(2.1, 0.03, 0.42, 0, 0.51, 0.02)]],
        [['#101114', rbox(1.42, 0.82, 0.06, 0, 1.3, 0, 0.02)], ['#1c1d22', box(0.4, 0.04, 0.18, 0, 0.52, 0)], ['#2a2b30', box(0.08, 0.1, 0.2, 0.7, 0.57, 0.1)]],
        [screen]
      )
    }
  },
  rug: {
    name: 'Ankara rug',
    w: 3.2,
    d: 2.6,
    solid: false,
    build: () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6).rotateX(-Math.PI / 2).translate(0, 0.012, 0), new THREE.MeshStandardMaterial({ map: ankaraTex(7, '#f2c12e', '#1d1d20', '#ffffff'), roughness: 0.95 }))
      m.receiveShadow = true
      const g = new THREE.Group()
      g.add(m)
      return g
    }
  },
  floor_lamp: {
    name: 'Floor lamp',
    w: 0.4,
    d: 0.4,
    solid: true,
    build: () => group([['#f2e2c0', cyl(0.14, 0.24, 0.32, 0, 1.62, 0, 16)]], [['#2a2b30', cyl(0.16, 0.18, 0.04, 0, 0.02, 0, 14)], ['#2a2b30', cyl(0.015, 0.015, 1.5, 0, 0.77, 0, 6)]])
  },
  snake_plant: {
    name: 'Snake plant',
    w: 0.4,
    d: 0.4,
    solid: true,
    build: () => {
      const P: Part[] = [['#a85a2a', cyl(0.16, 0.12, 0.32, 0, 0.16, 0, 14)]]
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        P.push([i % 2 ? '#2f6a3a' : '#4f8a3f', box(0.06, 0.75, 0.015, 0, 0.37, 0).rotateZ(0.12 * Math.sin(a * 3)).rotateY(a).translate(Math.cos(a) * 0.05, 0.3, Math.sin(a) * 0.05)])
      }
      return group(P)
    }
  },
  bookshelf: {
    name: 'Bookshelf',
    w: 1.0,
    d: 0.4,
    solid: true,
    build: () => {
      const P: Part[] = [[WOOD, box(1.0, 1.8, 0.05, 0, 0.9, -0.17)], [WOOD, box(0.05, 1.8, 0.38, -0.48, 0.9, 0)], [WOOD, box(0.05, 1.8, 0.38, 0.48, 0.9, 0)]]
      for (let i = 0; i < 5; i++) P.push([WOOD, box(0.92, 0.03, 0.36, 0, 0.05 + i * 0.42, 0)])
      const cols = ['#b8433a', '#3f6fae', '#e8b84b', '#2f7d5b', '#f2ede0', '#7a4a8a']
      for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) P.push([cols[(r * 3 + i) % cols.length], box(0.07, 0.26 + ((i * 7 + r) % 3) * 0.03, 0.24, -0.38 + i * 0.09, 0.2 + r * 0.42, 0)])
      return group(P)
    }
  },
  standing_fan: {
    name: 'Standing fan',
    w: 0.45,
    d: 0.45,
    solid: true,
    build: () => group([['#3f6fae', cyl(0.07, 0.07, 0.12, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(0, 1.12, 0.05)]], [['#e8e8e4', cyl(0.18, 0.2, 0.04, 0, 0.02, 0, 16)], ['#e8e8e4', cyl(0.02, 0.02, 1.0, 0, 0.52, 0, 6)], ['#cfd8dc', cyl(0.26, 0.26, 0.1, 0, 0, 0, 20).rotateX(Math.PI / 2).translate(0, 1.12, 0.05)]])
  },
  dining_set: {
    name: 'Dining set (4 chairs)',
    w: 1.6,
    d: 2.0,
    solid: true,
    build: () => {
      const P: Part[] = [['#7a5232', rbox(1.5, 0.06, 0.95, 0, 0.76, 0, 0.02)]]
      for (const [x, z] of [[-0.66, -0.4], [0.66, -0.4], [-0.66, 0.4], [0.66, 0.4]]) P.push(['#5a3a24', box(0.06, 0.74, 0.06, x, 0.37, z)])
      P.push(['#e8a020', sph(0.06, -0.05, 0.9, 0)], ['#c83a2a', sph(0.055, 0.07, 0.9, 0.04)], ['#7ab040', sph(0.055, 0.02, 0.92, -0.07)])
      const chair = (x: number, z: number, a: number) => {
        const parts: Part[] = [['#8a5a36', box(0.44, 0.05, 0.44, 0, 0.46, 0)], ['#8a5a36', box(0.44, 0.5, 0.05, 0, 0.72, -0.2)], ['#3f6a8a', rbox(0.4, 0.05, 0.4, 0, 0.5, 0.01, 0.02)]]
        for (const [ex, ez] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) parts.push(['#5a3a24', box(0.04, 0.46, 0.04, ex, 0.23, ez)])
        for (const [c, g] of parts) P.push([c, g.rotateY(a).translate(x, 0, z)])
      }
      chair(-0.35, -0.75, 0)
      chair(0.35, -0.75, 0)
      chair(-0.35, 0.75, Math.PI)
      chair(0.35, 0.75, Math.PI)
      return group(P, [['#f4f4f0', cyl(0.2, 0.12, 0.1, 0, 0.84, 0, 16)]])
    },
    spots: [
      { id: 'dining', x: -0.35, z: -1.3, seat: { x: -0.35, z: -0.78, h: 0.48, yaw: 0 } },
      { id: 'dining', x: 0.35, z: 1.3, seat: { x: 0.35, z: 0.78, h: 0.48, yaw: Math.PI } }
    ]
  },
  plastic_chair: {
    name: 'Plastic chair',
    w: 0.5,
    d: 0.5,
    solid: true,
    build: () => {
      const c = '#f2f2ee'
      const P: Part[] = [[c, box(0.45, 0.06, 0.45, 0, 0.45, 0)], [c, box(0.45, 0.45, 0.05, 0, 0.7, -0.22)]]
      for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) P.push([c, box(0.04, 0.45, 0.04, x, 0.22, z)])
      return group(P)
    },
    spots: [{ id: 'chair', x: 0, z: 0.75, seat: { x: 0, z: 0.02, h: 0.46, yaw: 0 } }]
  },
  bed_double: {
    name: 'Double bed',
    w: 1.7,
    d: 2.3,
    solid: true,
    build: () => {
      const P: Part[] = [
        [WOOD, rbox(1.6, 1.1, 0.1, 0, 0.55, -1.08, 0.04)],
        [WOOD, box(1.6, 0.28, 2.1, 0, 0.2, 0)],
        ['#f4f2ec', rbox(1.5, 0.22, 2.0, 0, 0.45, 0, 0.06)],
        ['#3f6fae', rbox(1.56, 0.1, 1.35, 0, 0.58, 0.35, 0.04)],
        ['#f4f2ec', rbox(0.6, 0.14, 0.38, -0.36, 0.62, -0.8, 0.06)],
        ['#f4f2ec', rbox(0.6, 0.14, 0.38, 0.36, 0.62, -0.8, 0.06)]
      ]
      return group(P)
    },
    spots: [{ id: 'bed', x: 0, z: 1.5, seat: { x: 0, z: 0.1, h: 0.52, yaw: 0 } }]
  },
  wardrobe: {
    name: 'Wardrobe',
    w: 1.45,
    d: 0.65,
    solid: true,
    build: () => group([[WOOD, box(1.4, 2.0, 0.6, 0, 1.0, 0)], ['#3a2416', box(0.01, 1.9, 0.01, 0, 1.0, 0.305)]], [['#c8ccd2', box(0.02, 0.2, 0.02, -0.08, 1.05, 0.31)], ['#c8ccd2', box(0.02, 0.2, 0.02, 0.08, 1.05, 0.31)]])
  },
  deep_freezer: {
    name: 'Deep freezer',
    w: 1.1,
    d: 0.7,
    solid: true,
    build: () => group([['#f4f6f8', rbox(1.1, 0.85, 0.65, 0, 0.43, 0, 0.04)], ['#dfe3e6', rbox(1.1, 0.06, 0.65, 0, 0.88, 0, 0.02)]], [['#9aa0a6', box(0.4, 0.03, 0.03, 0, 0.8, 0.34)], ['#2f7d5b', box(0.05, 0.05, 0.01, 0.42, 0.7, 0.33)]]),
    spots: [{ id: 'fridge', x: 0, z: 0.85 }]
  },
  generator: {
    name: 'Generator',
    w: 0.75,
    d: 0.55,
    solid: true,
    build: () => group([['#d8262e', rbox(0.7, 0.45, 0.5, 0, 0.36, 0, 0.05)], ['#2a2b30', box(0.72, 0.06, 0.52, 0, 0.1, 0)]], [['#2a2b30', box(0.04, 0.5, 0.04, -0.33, 0.45, 0)], ['#2a2b30', box(0.04, 0.5, 0.04, 0.33, 0.45, 0)], ['#e6c66a', cyl(0.06, 0.06, 0.05, 0.15, 0.62, 0, 12)]])
  }
}

/** rotate a local point by quarter turns (matches Object3D.rotation.y = rot * PI/2) */
export function rotLocal(x: number, z: number, rot: number): [number, number] {
  const a = (rot * Math.PI) / 2
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [x * c + z * s, -x * s + z * c]
}

/** the starter furniture, laid out like the classic room for this size */
export function starterLayout(W: number, D: number): Array<Omit<Placed, 'uid'>> {
  const backZ = -D / 2 + 4.2
  const lz0 = backZ + 0.2
  const lzMid = (lz0 + D / 2) / 2
  const tvX = -W / 2 + 0.32
  const sx = tvX + 3.3
  const cx2 = (tvX + sx) / 2 + 0.2
  const az = lzMid + 2.0 > D / 2 - 1.6 ? lzMid - 2.0 : lzMid + 2.0
  const xBed1 = -W / 2 + 4.6
  return [
    { sku: 'tv_console', x: tvX, z: lzMid, rot: 1 },
    { sku: 'sofa3', x: sx + 0.05, z: lzMid, rot: 3 },
    { sku: 'armchair', x: sx - 1.1, z: az, rot: 3 },
    { sku: 'coffee_table', x: cx2, z: lzMid, rot: 1 },
    { sku: 'rug', x: cx2 + 0.3, z: lzMid, rot: 1 },
    { sku: 'floor_lamp', x: -W / 2 + 0.5, z: D / 2 - 0.6, rot: 0 },
    { sku: 'snake_plant', x: W / 2 - 0.45, z: D / 2 - 0.45, rot: 0 },
    { sku: 'snake_plant', x: sx + 0.6, z: lzMid + 1.6, rot: 0 },
    { sku: 'standing_fan', x: sx + 0.9, z: lz0 + 0.5, rot: 0 },
    { sku: 'dining_set', x: W / 2 - 1.7, z: lz0 + 1.3, rot: 0 },
    { sku: 'bed_double', x: -W / 2 + 1.1, z: -D / 2 + 1.3, rot: 0 },
    { sku: 'wardrobe', x: xBed1 - 0.35, z: -D / 2 + 1.2, rot: 3 }
  ]
}
