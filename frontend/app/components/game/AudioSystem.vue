<script setup lang="ts">
// AudioSystem - mounts the WebAudio engine outside the canvas: starts on
// the first user gesture (autoplay policy), then keeps the ambient bed
// (wind, hum, birds, crickets, market chatter, river) in sync with where
// you are and what time it is. Mute state persists in localStorage.
import { kkAudio, zoneLevels } from '~/utils/audio'
import { BAKE } from '~/utils/kaduna'

// crowd noise around every market / motor park of the current town
const MARKETS = BAKE.landmarks.filter((l) => l.kind === 'market' || l.kind === 'motorpark')
function marketLevel(x: number, z: number) {
  const d = MARKETS.length ? Math.min(...MARKETS.map((m) => Math.hypot(m.x - x, m.z - z))) : 9999
  const v = Math.max(0, 1 - d / 140)
  return v * v
}

const playerPos = useState<[number, number, number]>('kk_player_pos', () => [-294, 0, 120])
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
    const zl = zoneLevels(x, z, nightFactor.value)
    zl.market = Math.max(zl.market, marketLevel(x, z))
    kkAudio.update(0.25, true, zl)
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
    class="pointer-events-auto relative inline-flex h-6 w-11 items-center rounded-full transition-colors" :class="muted ? 'bg-ink/20' : 'bg-leaf'" role="switch" :aria-checked="!muted"
    :title="muted ? 'Sound off (P)' : 'Sound on (P)'"
    @click.stop="toggleMute"
  >
    <span class="absolute h-5 w-5 rounded-full bg-white shadow transition-all" :class="muted ? 'left-0.5' : 'left-[1.375rem]'" />
  </button>
</template>
