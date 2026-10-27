<script setup lang="ts">
// DialogueBox - the story's people speaking (stores/story, one line per
// card, tap or E for the next), else NPC small talk from the DSH runtime
// (or its deterministic fallback).
const ui = useUiStore()
const line = computed(() => ui.story[0] ?? null)
function onKey(e: KeyboardEvent) {
  if (!line.value || e.repeat) return
  if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault()
    e.stopImmediatePropagation()
    ui.nextLine()
  }
}
onMounted(() => window.addEventListener('keydown', onKey, { capture: true }))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, { capture: true }))
</script>

<template>
  <div class="pointer-events-auto absolute inset-x-0 bottom-4 z-30 flex justify-center px-3">
    <transition
      enter-active-class="transition duration-200"
      enter-from-class="translate-y-6 opacity-0"
      leave-active-class="transition duration-200"
      leave-to-class="translate-y-6 opacity-0"
    >
      <div v-if="line" class="kk-panel w-[min(640px,94vw)] cursor-pointer p-4 [@media(max-height:500px)]:w-[min(56vw,640px)] [@media(max-height:500px)]:p-3" role="status" aria-live="polite" @click="ui.nextLine()">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="flex h-9 w-9 items-center justify-center rounded-full bg-gold font-display text-sm font-semibold text-white">{{ line.name.replace(/^(mallam|hajiya|alhaji|mama|professor)\s+/i, '').charAt(0) }}</span>
            <div>
              <div class="font-display text-sm font-semibold leading-tight text-ink">{{ line.name }}</div>
              <div v-if="line.role" class="text-[11px] leading-tight text-ink/50">{{ line.role }}</div>
            </div>
          </div>
          <span class="kk-chip text-golddark">Story</span>
        </div>
        <p class="mt-2.5 text-[15px] leading-relaxed text-ink/85">{{ line.text }}</p>
        <div class="mt-1.5 text-right text-[11px] font-bold text-ink/40">{{ ui.story.length > 1 ? 'Next' : 'Close' }} <span class="rounded-md bg-ink/10 px-1.5 py-0.5">E</span></div>
      </div>
      <div v-else-if="ui.dialogue" class="kk-panel w-[min(640px,94vw)] p-4 [@media(max-height:500px)]:w-[min(56vw,640px)] [@media(max-height:500px)]:p-3" role="status" aria-live="polite">
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
