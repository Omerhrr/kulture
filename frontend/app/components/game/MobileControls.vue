<script setup lang="ts">
// MobileControls - everything touch: the movement joystick, the interact
// button, vehicle riding buttons (view + exit), the map button, the
// landscape prompt, and a best-effort fullscreen + orientation lock when
// the player enters the world on a phone.

import { fireKkEvent, useMapOpen } from '~/composables/useControlsState'

const isTouch = useIsTouch()
const proximity = useState<{ entityId: string; name: string; code: string } | null>('kk_proximity', () => null)
const ride = useRide()
const mapOpen = useMapOpen()

const portraitDismissed = ref(true)
let landscapeTried = false

onMounted(() => {
  if (!isTouch.value) return
  portraitDismissed.value = localStorage.getItem('kk_portrait_dismiss') === '1'
})

function fireInteract() {
  window.dispatchEvent(new CustomEvent('kk-do-interact'))
}

function dismissPortrait() {
  portraitDismissed.value = true
  localStorage.setItem('kk_portrait_dismiss', '1')
  tryLandscape()
}

/** Best effort: fullscreen + landscape lock (needs a user gesture; iOS ignores). */
function tryLandscape() {
  if (landscapeTried || !isTouch.value) return
  landscapeTried = true
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>
  }
  try {
    const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el)
    const after = () => {
      try {
        (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
          .lock?.('landscape')
          .catch(() => {})
      } catch {}
    }
    if (req) req().then(after).catch(() => {})
  } catch {}
}
</script>

<template>
  <template v-if="isTouch">
    <TouchJoystick />

    <!-- side action buttons -->
    <div class="fixed bottom-8 right-5 z-40 flex flex-col items-center gap-3">
      <!-- map -->
      <button
        class="pointer-events-auto flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border-2 border-white/40 bg-ink/25 text-xl text-white/90 shadow-xl backdrop-blur-sm transition active:scale-95"
        @pointerdown.stop="mapOpen = !mapOpen"
      >
        🗺
      </button>
      <!-- ride view toggle while driving -->
      <button
        v-if="ride.active"
        class="pointer-events-auto flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border-2 border-white/40 bg-ink/25 text-xl text-white/90 shadow-xl backdrop-blur-sm transition active:scale-95"
        @pointerdown.stop="fireKkEvent('kk-ride-view')"
      >
        {{ ride.inner ? '🚗' : '🪑' }}
      </button>
      <!-- interact / board / exit -->
      <button
        class="pointer-events-auto flex h-[76px] w-[76px] touch-none select-none flex-col items-center justify-center rounded-full border-2 text-xs font-extrabold shadow-xl transition active:scale-95"
        :class="
          ride.active || ride.prompt || proximity
            ? 'border-gold/80 bg-gold/90 text-ink'
            : 'border-white/40 bg-ink/25 text-white/70 backdrop-blur-sm'
        "
        @pointerdown.stop="fireInteract"
      >
        <span class="block text-2xl leading-none">{{ ride.active ? '🛴' : ride.prompt ? '🔑' : '✋' }}</span>
        <span class="mt-0.5 block">{{ ride.active ? 'EXIT' : ride.prompt ? 'BOARD' : 'TALK' }}</span>
      </button>
    </div>

    <!-- portrait: rotate prompt -->
    <div
      v-if="!portraitDismissed"
      class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-ink/90 p-8 text-center text-white"
    >
      <div class="animate-bounce text-6xl">📱</div>
      <h2 class="font-display text-xl font-bold">Rotate your phone</h2>
      <p class="max-w-xs text-sm text-white/70">
        Kaduna Kulture plays best in landscape. Turn your device sideways for the full city view.
      </p>
      <button class="kk-btn-primary !px-6" @click="dismissPortrait">I rotated it, continue</button>
      <button class="text-xs text-white/50 underline" @click="portraitDismissed = true">Keep portrait anyway</button>
    </div>
  </template>
</template>
