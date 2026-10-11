<script setup lang="ts">
// CameraRig - third-person follow camera with user orbit.
// Must live INSIDE <TresCanvas> so useLoop binds to the canvas render loop.
// Right-drag / one-finger drag orbits (yaw + pitch), wheel or pinch zooms
// (see PointerControls). Keyboard/joystick/click movement stays available.

import * as THREE from 'three'
import { ridePose } from '~/utils/rideState'
import { INTERIOR_DROP } from '~/utils/kadunaExtras'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const orbit = useCamOrbit()
const ride = useRide()
const interior = useInterior()

const camera = ref()
const followTarget = new THREE.Vector3()
const desired = new THREE.Vector3()

// smoothed orbit values so the view glides instead of jumping
const smooth = { yaw: 0, pitch: 0.58, dist: 20 }

const { onBeforeRender } = useLoop()
const ctxAny = useTresContext() as any

const loopStats = { before: 0, after: 0 }

// dev debug hook: expose render stats for headless verification
if (import.meta.dev) {
  ;(window as any).__kk_ctx = ctxAny
  ;(window as any).__kk_setcam = (yaw: number, pitch: number, dist: number) => {
    orbit.value.yaw = yaw
    orbit.value.pitch = pitch
    orbit.value.dist = dist
  }
  ;(window as any).__kk_tres = () => {
    const r = ctxAny.renderer?.value ?? ctxAny.renderer?.instance
    const s = ctxAny.scene?.value ?? ctxAny.scene
    const bad: string[] = []
    s?.traverse?.((o: any) => {
      const g = o.geometry
      if (!g?.attributes?.position) return
      const arr = g.attributes.position.array as Float32Array
      for (let i = 0; i < Math.min(arr.length, 9000); i++) {
        if (!Number.isFinite(arr[i])) {
          const chain: string[] = []
          let p = o.parent
          while (p && chain.length < 6) {
            chain.push(p.type || '?')
            p = p.parent
          }
          bad.push(
            `${o.type} geo=${g.type} pos=[${o.position.x},${o.position.y},${o.position.z}] scale=[${o.scale?.x},${o.scale?.y},${o.scale?.z}] parents=${chain.join('<')}`
          )
          break
        }
      }
    })
    return {
      hasRenderer: !!r,
      calls: r?.info?.render?.calls,
      frames: r?.info?.render?.frame,
      children: s?.children?.length,
      activeCam: !!(ctxAny as any)?.camera?.activeCamera?.value,
      loopBefore: loopStats.before,
      loopAfter: loopStats.after,
      cameras: (ctxAny as any)?.camera?.cameras?.value?.map?.((c: any) => c.type) || null,
      nanGeometries: bad.slice(0, 8)
    }
  }
}

onBeforeRender(({ delta }) => {
  loopStats.before++
  const cam = camera.value
  if (!cam) return
  const k = 1 - Math.pow(0.0015, Math.min(delta || 0.016, 0.1)) // frame-rate safe damping
  smooth.yaw += (orbit.value.yaw - smooth.yaw) * k
  smooth.pitch += (orbit.value.pitch - smooth.pitch) * k
  smooth.dist += (orbit.value.dist - smooth.dist) * k

  // cockpit view: camera rides inside the vehicle, looking forward
  if (ride.value.active && ride.value.inner && ridePose.active) {
    const h = ridePose.heading
    const fx = Math.sin(h)
    const fz = Math.cos(h)
    const px = ridePose.x + fx * ridePose.cockpitFwd
    const pz = ridePose.z + fz * ridePose.cockpitFwd
    cam.position.set(px, ridePose.y + ridePose.cabin, pz)
    cam.lookAt(px + fx * 30, ridePose.y + ridePose.cabin - 1.5, pz + fz * 30)
    return
  }

  const px = ride.value.active ? ridePose.x : playerPos.value[0]
  const pz = ride.value.active ? ridePose.z : playerPos.value[2]
  // chase view tracks the vehicle body (boats bob, planes climb)
  const vy = ride.value.active ? ridePose.y : interior.value.inside ? -INTERIOR_DROP : 0
  const horiz = Math.cos(smooth.pitch) * smooth.dist
  desired.set(
    px + Math.sin(smooth.yaw) * horiz,
    vy + 1.4 + Math.sin(smooth.pitch) * smooth.dist,
    pz + Math.cos(smooth.yaw) * horiz
  )
  cam.position.lerp(desired, k)
  followTarget.set(px, vy + 1.6, pz)
  cam.lookAt(followTarget)
})
</script>

<template>
  <TresPerspectiveCamera
    ref="camera"
    :position="[-98, 13, 104]"
    :fov="55"
    :near="0.5"
    :far="4200"
  />
</template>
