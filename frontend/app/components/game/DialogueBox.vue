<script setup lang="ts">
// DialogueBox - NPC dialogue from the DSH runtime (or deterministic fallback).
const ui = useUiStore()
</script>

<template>
  <div class="pointer-events-auto absolute inset-x-0 bottom-4 z-30 flex justify-center px-3">
    <transition
      enter-active-class="transition duration-200"
      enter-from-class="translate-y-6 opacity-0"
      leave-active-class="transition duration-200"
      leave-to-class="translate-y-6 opacity-0"
    >
      <div v-if="ui.dialogue" class="kk-panel w-[min(680px,94vw)] p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-lg">🧑🏾‍🌾</span>
            <span class="font-display text-sm font-semibold text-ink">{{ ui.dialogue.npcName }}</span>
            <span class="kk-chip" :class="ui.dialogue.engine === 'dsh_llm' ? 'text-leaf' : 'text-ink/50'">
              {{ ui.dialogue.engine === 'dsh_llm' ? '🤖 DSH agent' : '⚙️ scripted fallback' }}
            </span>
          </div>
          <button class="kk-btn-ghost !px-2 !py-1" @click="ui.dialogue = null">✕</button>
        </div>
        <p class="mt-2 text-sm leading-relaxed text-ink/85">{{ ui.dialogue.text }}</p>
      </div>
    </transition>
  </div>
</template>
