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
      <div v-if="ui.dialogue" class="kk-panel w-[min(640px,94vw)] p-4 [@media(max-height:500px)]:w-[min(56vw,640px)] [@media(max-height:500px)]:p-3" role="status" aria-live="polite">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="flex h-9 w-9 items-center justify-center rounded-full bg-kadeep font-display text-sm font-semibold text-white">{{ ui.dialogue.npcName.replace(/^(mallam|hajiya|alhaji)\s+/i, '').charAt(0) }}</span>
            <span class="font-display text-sm font-semibold text-ink">{{ ui.dialogue.npcName }}</span>
            <span class="kk-chip" :class="ui.dialogue.engine === 'dsh_llm' ? 'text-leaf' : 'text-ink/50'" :title="ui.dialogue.engine === 'dsh_llm' ? 'Live AI agent' : 'Offline: scripted lines'">
              {{ ui.dialogue.engine === 'dsh_llm' ? 'AI shopkeeper' : 'Scripted' }}
            </span>
          </div>
          <button class="kk-close" aria-label="Close" @click="ui.dialogue = null">✕</button>
        </div>
        <p class="mt-2.5 text-[15px] leading-relaxed text-ink/85">{{ ui.dialogue.text }}</p>
      </div>
    </transition>
  </div>
</template>
