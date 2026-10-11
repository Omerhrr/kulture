// Kaduna city layout, baked from OpenStreetMap data by
// scripts/kaduna-osm/bake_kaduna.py. One unit = 10 m, origin = Murtala
// Square, +X = east, +Z = south (Three.js convention).
//
// Data: (c) OpenStreetMap contributors, ODbL. Geometry is stylized and
// approximate; landmark positions follow OSM where mapped.

import bakeJson from './kadunaBake.json'

export interface BakeRoad {
  name: string
  class: string
  pts: [number, number][]
}
export interface BakeLandmark {
  key: string
  name: string
  x: number
  z: number
  kind: string
  kw: number
  kd: number
  lh: number
}
export interface BakePlace {
  name: string
  x: number
  z: number
}
export interface BakeBridge {
  name: string
  x: number
  z: number
  rot: number
  w: number
}
export interface KadunaBake {
  meta: {
    attribution: string
    origin: number[]
    unitM: number
    bounds: { xmin: number; xmax: number; zmin: number; zmax: number }
  }
  river: { main: [number, number][]; width: number; side: [number, number][][] }
  roads: BakeRoad[]
  rail: [number, number][][]
  airport: { runway: [number, number][] | null; apron: { x: number; z: number; w: number; d: number } | null }
  landmarks: BakeLandmark[]
  places: BakePlace[]
  bridges: BakeBridge[]
  houses: [number, number, number, number, number, number, number][]
  housePalettes: { wall: string[]; roof: string[] }
  trees: [number, number, number][]
}

export const BAKE = bakeJson as unknown as KadunaBake
export const WORLD = BAKE.meta.bounds

export function clampWorld(x: number, z: number): [number, number] {
  return [
    Math.max(WORLD.xmin, Math.min(WORLD.xmax, x)),
    Math.max(WORLD.zmin, Math.min(WORLD.zmax, z))
  ]
}

// friendly display names for bridges detected on the river
export const BRIDGE_NAMES: Record<string, string> = {
  'Junction Road': 'Coronation Bridge',
  "Umaru Musa Yar'adua Way": "Yar'adua Way Bridge",
  'Nnamdi Azikwe Way': 'Nnamdi Azikiwe Bridge'
}

// server-owned playable entities (world_entities rows) in the new city map
export const PLAYABLE_POS: Record<string, [number, number]> = {
  spawn_roadside: [-98, 40],
  musa_shop: [-70, 75],
  arewa_pos: [-25, 8],
  kaduna_central_market: [-80, 102],
  arewa_house: [-20, -164],
  stonetech_square: [-55, 360],
  keke_stop: [-245, 420],
  npc_musa: [-74, 70],
  npc_amina: [-60, 355]
}
