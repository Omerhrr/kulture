<script setup lang="ts">
// TouchJoystick - on-screen movement stick for touch devices.
// Writes a normalized vector (screen-right / screen-up, -1..1) into the
// shared kk_touch_move state; PlayerAvatar maps it onto the camera basis.

const touchMove = useTouchMove()

const base = ref<HTMLElement>()
const knob = ref<HTMLElement>()
const RADIUS = 44 // px of travel

let pointerId: number | null = null

function setVec(dx: number, dy: number) {
  const len = Math.hypot(dx, dy)
  const clamped = Math.min(len, RADIUS)
  const nx = len > 0 ? (dx / len) * (clamped / RADIUS) : 0
  const ny = len > 0 ? (dy / len) * (clamped / RADIUS) : 0
  if (knob.value) knob.value.style.transform = `translate(${nx * RADIUS}px, ${ny * RADIUS}px)`
  touchMove.value = { x: nx, y: -ny, active: true } // screen-up is +y in game space
}

function onDown(e: PointerEvent) {
  if (pointerId !== null) return
  pointerId = e.pointerId
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    // synthetic pointers and some stylus edge cases cannot be captured
  }
  e.preventDefault()
  useMoveTarget().value = null
}

function onMove(e: PointerEvent) {
  if (e.pointerId !== pointerId || !base.value) return
  const rect = base.value.getBoundingClientRect()
  const dx = e.clientX - (rect.left + rect.width / 2)
  const dy = e.clientY - (rect.top + rect.height / 2)
  setVec(dx, dy)
  e.preventDefault()
}

function onUp(e: PointerEvent) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  if (knob.value) knob.value.style.transform = 'translate(0px, 0px)'
  touchMove.value = { x: 0, y: 0, active: false }
}
</script>

<template>
  <div
    ref="base"
    class="pointer-events-auto fixed bottom-6 left-5 z-40 h-[124px] w-[124px] touch-none select-none rounded-full border-2 border-white/40 bg-ink/25 shadow-xl backdrop-blur-sm"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <div class="absolute inset-0 m-auto h-[52px] w-[52px] rounded-full bg-white/75 shadow-lg" ref="knob" />
    <div class="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-white/80">
      MOVE
    </div>
  </div>
</template>
