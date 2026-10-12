// Bridge between the 3D canvas and the HTML city-map layer: the canvas
// publishes its camera here every frame; the map overlay projects its
// bubbles with it in its own animation frame (no Vue reactivity churn).
import * as THREE from 'three'

export const view = { cam: null as THREE.Camera | null, el: null as HTMLElement | null }
const v = new THREE.Vector3()

/** world -> CSS pixels relative to the canvas; null when behind the camera */
export function project(x: number, y: number, z: number): [number, number] | null {
  const cam = view.cam
  const el = view.el
  if (!cam || !el) return null
  v.set(x, y, z).project(cam)
  if (v.z > 1 || v.z < -1) return null
  return [(v.x * 0.5 + 0.5) * el.clientWidth, (-v.y * 0.5 + 0.5) * el.clientHeight]
}
