<script setup lang="ts">
// The phone arcade on its own page (handy on a slow device: no 3D city).
definePageMeta({ layout: false })
useHead({ title: 'Arcade · Kaduna Kulture' })
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-gradient-to-b from-[#1e1b4b] to-[#9d174d] p-3">
    <div class="w-[min(340px,94vw)] rounded-[2.4rem] bg-[#111] p-2.5 shadow-2xl">
      <div class="rounded-[2rem] bg-white/95 p-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="font-display text-lg font-semibold text-ink">👾 Arcade</div>
          <NuxtLink to="/game" class="rounded-full bg-ink/10 px-3 py-1 text-xs font-bold text-ink">‹ City</NuxtLink>
        </div>
        <PhoneArcade />
      </div>
    </div>
  </div>
</template>
