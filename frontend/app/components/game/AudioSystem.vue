<script setup lang="ts">
// AudioSystem - mounts the WebAudio engine outside the canvas: starts on
// the first user gesture (autoplay policy), then keeps the ambient bed
// (wind, hum, birds, crickets, market chatter, river) in sync with where
// you are and what time it is. Mute state persists in localStorage.
import { kkAudio, zoneLevels } from '~/utils/audio'

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-98, 0, 40])
const nightFactor = useState<number>('kk_night', () => 0)

const muted = useState<boolean>('kk_muted', () => false)
const started = useState<boolean>('kk_audio_started', () => false)

function firstGesture() {
  kkAudio.init()
  started.value = kkAudio.ready
  if (started.value) {
    window.removeEventListener('pointerdown', firstGesture)
    window.removeEventListener('keydown', firstGesture)
  }
}

onMounted(() => {
  muted.value = kkAudio.restoreMute()
  window.addEventListener('pointerdown', firstGesture)
  window.addEventListener('keydown', firstGesture)
  // zone refresh at 4 Hz
  const timer = window.setInterval(() => {
    if (!kkAudio.ready) return
    const [x, , z] = playerPos.value
    kkAudio.update(0.25, true, zoneLevels(x, z, nightFactor.value))
  }, 250)
  onBeforeUnmount(() => window.clearInterval(timer))
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', firstGesture)
  window.removeEventListener('keydown', firstGesture)
})

function toggleMute() {
  kkAudio.setMuted(!muted.value)
  muted.value = kkAudio.isMuted
}

// HUD button + headless probe
if (import.meta.client) {
  ;(window as any).__kk_toggle_mute = toggleMute
}
if (import.meta.dev) {
  ;(window as any).__kk_audio = () => ({
    ready: kkAudio.ready,
    muted: kkAudio.isMuted,
    started: started.value,
    night: +nightFactor.value.toFixed(2)
  })
}
</script>

<template>
  <button
    class="pointer-events-auto kk-btn-ghost !px-3"
    :title="muted ? 'Sound off (P)' : 'Sound on (P)'"
    @click.stop="toggleMute"
  >
    {{ muted ? '🔇' : '🔊' }}
  </button>
</template>
