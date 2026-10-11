<script setup lang="ts">
// PointerControls - mouse + touch steering for the 3D world.
//
// Left click / tap on the ground: walk there (click-to-move).
// Right-drag (or two-finger drag): orbit the camera around the player.
// Wheel / pinch: zoom.
//
// Lives INSIDE <TresCanvas> so it can reach the live camera and renderer.

import * as THREE from 'three'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [0, 0, 42])
const moveTarget = useMoveTarget()
const orbit = useCamOrbit()

const { renderer, camera } = useTresContext()

const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const ndc = new THREE.Vector2()
const hit = new THREE.Vector3()

function groundPoint(clientX: number, clientY: number): [number, number] | null {
  const el = renderer.instance?.domElement as HTMLCanvasElement | undefined
  const cam = camera.activeCamera?.value
  if (!el || !cam) return null
  const rect = el.getBoundingClientRect()
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, cam as THREE.Camera)
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null
  return [hit.x, hit.z]
}

onMounted(() => {
  const el = renderer.instance?.domElement as HTMLCanvasElement | undefined
  if (!el) return

  let downX = 0
  let downY = 0
  let downButton = -1
  let dragging = false

  el.addEventListener('contextmenu', (e) => e.preventDefault())

  el.addEventListener('pointerdown', (e) => {
    downX = e.clientX
    downY = e.clientY
    downButton = e.button
    dragging = downButton !== 0 // right/middle starts orbit immediately
    if (downButton !== 0) el.setPointerCapture(e.pointerId)
  })

  el.addEventListener('pointermove', (e) => {
    if (downButton === -1) return
    if (downButton !== 0) {
      // orbit: right/middle drag rotates the camera around the player
      orbit.value.yaw -= (e.clientX - downX) * 0.008
      orbit.value.pitch = Math.min(1.25, Math.max(0.15, orbit.value.pitch + (e.clientY - downY) * 0.005))
      downX = e.clientX
      downY = e.clientY
      dragging = true
      return
    }
    // left button: once the gesture grows past a few pixels it becomes an
    // orbit drag instead of a click-to-move
    if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
      dragging = true
      el.setPointerCapture(e.pointerId)
    }
    if (dragging) {
      orbit.value.yaw -= (e.movementX || 0) * 0.008
      orbit.value.pitch = Math.min(1.25, Math.max(0.15, orbit.value.pitch + (e.movementY || 0) * 0.005))
    }
  })

  const finish = (e: PointerEvent) => {
    if (downButton === 0 && !dragging) {
      // a clean left click: walk to the picked ground point
      const p = groundPoint(e.clientX, e.clientY)
      if (p) {
        const [x, z] = p
        if (Math.hypot(x - playerPos.value[0], z - playerPos.value[2]) > 0.6) {
          moveTarget.value = { x, z }
        }
      }
    }
    downButton = -1
    dragging = false
  }
  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', () => {
    downButton = -1
    dragging = false
  })

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      orbit.value.dist = Math.min(44, Math.max(8, orbit.value.dist + e.deltaY * 0.02))
    },
    { passive: false }
  )
})
</script>

<template>
  <TresGroup />
</template>
