<script setup lang="ts">
// InteractionPrompt - nearest interactable + action menu (options are
// server-validated on interaction; the client never decides what is possible).

const proximity = useState<{ entityId: string; name: string; code: string } | null>(
  'kk_proximity',
  () => null
)
const ui = useUiStore()
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center">
    <transition
      enter-active-class="transition duration-200"
      enter-from-class="translate-y-4 opacity-0"
      leave-active-class="transition duration-200"
      leave-to-class="translate-y-4 opacity-0"
    >
      <div v-if="proximity && !ui.anyBlocking" class="kk-panel pointer-events-auto px-5 py-3.5 text-center">
        <div class="text-[11px] font-bold uppercase tracking-widest text-ink/40">{{ proximity.code.replace(/_/g, ' ') }}</div>
        <div class="font-display text-base font-semibold text-ink">{{ proximity.name }}</div>
        <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button class="kk-btn-primary" @click="ui.interactWith(proximity)">
            Talk / Interact <span class="ml-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px]">E</span>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
