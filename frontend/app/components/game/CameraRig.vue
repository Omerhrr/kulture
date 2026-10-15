<script setup lang="ts">
import { perf as _perf } from '~/utils/quality'
const PERF_FAR = _perf().far
// CameraRig - third-person follow camera with user orbit.
// Must live INSIDE <TresCanvas> so useLoop binds to the canvas render loop.
// Right-drag / one-finger drag orbits (yaw + pitch), wheel or pinch zooms
// (see PointerControls). Keyboard/joystick/click movement stays available.

import * as THREE from 'three'
import { ridePose } from '~/utils/rideState'
import { heightAt } from '~/utils/terrain'
import { INTERIOR_DROP } from '~/utils/kadunaExtras'
import { impact } from '~/utils/impact'
import { hitsBuilding } from '~/utils/collision'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
const orbit = useCamOrbit()
const ride = useRide()
const interior = useInterior()

const camera = ref()
const followTarget = new THREE.Vector3()
const desired = new THREE.Vector3()
// occlusion: shortened boom length when a building sits between player and camera
let occl = 99
const cityMap = useCityMap()
let mapWasActive = false
if (import.meta.dev && typeof window !== 'undefined') (window as any).__kk_cam = () => ({ occl, smooth: { ...smooth }, hit: (x: number, z: number) => hitsBuilding(x, z, 0.35) })

// smoothed orbit values so the view glides instead of jumping
// close third-person framing: the character fills a good share of the
// screen (the old 20 m / steep pitch made people look like ants)
const smooth = { yaw: 0, pitch: 0.32, dist: 8.5 }

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
  ;(window as any).__kk_scene = () => ctxAny.scene?.value ?? ctxAny.scene
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

  // inside a home: elevated doll's-house view (Interiors cuts away the
  // walls facing the camera), so keep the camera high and comfortably far
  if (interior.value.inside) {
    orbit.value.dist = Math.max(6.5, Math.min(orbit.value.dist, 15))
    orbit.value.pitch = Math.max(0.72, Math.min(orbit.value.pitch, 1.3))
  }
  if (snapNext) {
    // instant framing (entering a house / leaving it) - no slow damping
    snapNext = false
    smooth.yaw = orbit.value.yaw
    smooth.pitch = orbit.value.pitch
    smooth.dist = orbit.value.dist
  } else {
    smooth.yaw += (orbit.value.yaw - smooth.yaw) * k
    smooth.pitch += (orbit.value.pitch - smooth.pitch) * k
    smooth.dist += (orbit.value.dist - smooth.dist) * k
  }
  // 3D city map: a tilted overview of the live city around the map focus
  const cm = cityMap.value
  if (cm.active) {
    const pitch = 0.95
    const h = Math.cos(pitch) * cm.dist
    desired.set(cm.fx + Math.sin(cm.yaw) * h, Math.sin(pitch) * cm.dist, cm.fz + Math.cos(cm.yaw) * h)
    if (!mapWasActive) cam.position.copy(desired)
    else cam.position.lerp(desired, Math.min(1, k * 2))
    mapWasActive = true
    cam.lookAt(cm.fx, 0, cm.fz)
    return
  }
  if (mapWasActive) {
    mapWasActive = false
    snapNext = true
  }
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
  const vy = ride.value.active ? ridePose.y : interior.value.inside ? -INTERIOR_DROP : heightAt(px, pz)
  let dist = smooth.dist
  if (!ride.value.active && !interior.value.inside && smooth.pitch < 1.15) {
    // march the boom outwards; stop just before the first wall
    const sy = Math.sin(smooth.yaw)
    const cy = Math.cos(smooth.yaw)
    const cp = Math.cos(smooth.pitch)
    let free = smooth.dist
    for (let t = 0.5; t <= smooth.dist; t += 0.4) {
      if (hitsBuilding(px + sy * cp * t, pz + cy * cp * t, 0.45)) {
        free = Math.max(0.35, t - 0.5)
        break
      }
    }
    // snap in fast, ease back out slowly so it doesn't pump
    occl = free < occl ? free : occl + (free - occl) * Math.min(1, (delta || 0.016) * 2)
    dist = Math.min(dist, occl)
    // pinned against a wall: swing the boom toward the most open side
    if (free < 2.5) {
      let bestYaw = smooth.yaw
      let bestFree = free
      for (let i = 1; i <= 6; i++) {
        for (const sgn of [1, -1]) {
          const y = smooth.yaw + sgn * i * (Math.PI / 6)
          let f = 0
          for (let t = 0.5; t <= 6; t += 0.5) {
            if (hitsBuilding(px + Math.sin(y) * cp * t, pz + Math.cos(y) * cp * t, 0.45)) break
            f = t
          }
          if (f > bestFree + 0.5) {
            bestFree = f
            bestYaw = y
          }
        }
        if (bestFree >= 5) break
      }
      const step = Math.min(1, (delta || 0.016) * 2.5)
      orbit.value.yaw += (bestYaw - orbit.value.yaw) * step
    }
  } else occl = 99
  // driving a car/keke/okada: low chase camera just over the roof, looking
  // down the road ahead (the road fills the frame, horizon high)
  const lowChase = ride.value.active && !ride.value.inner && ridePose.cabin < 2.2
  const pitchUse = lowChase ? Math.min(smooth.pitch, 0.17) : smooth.pitch
  if (lowChase) dist = Math.min(dist, 6.4)
  const horiz = Math.cos(pitchUse) * dist
  // squeezed against a wall: rise up over the shoulder and look down so
  // the street stays readable instead of filling the screen with wall
  const lift = dist < smooth.dist ? Math.max(0, 2.5 - dist) * 0.35 : 0
  desired.set(
    px + Math.sin(smooth.yaw) * horiz,
    vy + (lowChase ? 1.15 : 1.55) + Math.sin(pitchUse) * dist + lift,
    pz + Math.cos(smooth.yaw) * horiz
  )
  if (snapNext) {
    snapNext = false
    cam.position.copy(desired)
  } else {
    cam.position.lerp(desired, k)
  }
  if (lowChase) {
    followTarget.set(px + Math.sin(ridePose.heading) * 5, vy + 1.05, pz + Math.cos(ridePose.heading) * 5)
  } else followTarget.set(px, vy + 1.45, pz)
  // impact shake: a quick decaying jitter on the look target
  if (impact.shake > 0.01) {
    const t = performance.now() / 1000
    const a = impact.shake * 0.35
    followTarget.x += Math.sin(t * 61) * a
    followTarget.y += Math.sin(t * 47 + 1.3) * a * 0.7
    followTarget.z += Math.cos(t * 53) * a
    impact.shake *= Math.exp(-(delta || 0.016) * 4.5)
  }
  cam.lookAt(followTarget)
})

// entering a house snaps the camera to a cozy interior framing
let snapNext = false
watch(
  () => interior.value.inside,
  (inside) => {
    if (inside) {
      orbit.value.dist = 10.5
      orbit.value.pitch = 0.95
    } else {
      orbit.value.dist = 8.5
      orbit.value.pitch = 0.32
    }
    snapNext = true
  }
)
</script>

<template>
  <TresPerspectiveCamera
    ref="camera"
    :position="[-294, 13, 184]"
    :fov="62"
    :near="0.25"
    :far="PERF_FAR"
  />
</template>
