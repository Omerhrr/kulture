<script setup lang="ts">
import { getQuality } from '~/utils/quality'
// The live 3D city behind the hero builds the whole map (and that build is
// reused when you enter the game). Phones / weak devices get a still
// backdrop instead; on desktops it waits until the page is up and the
// buttons work, then builds in the background.
const showHero = ref(false)
onMounted(() => {
  if (getQuality() === 'low') return
  const go = () => (showHero.value = true)
  const ric = (window as any).requestIdleCallback as ((f: () => void, o?: { timeout: number }) => number) | undefined
  setTimeout(() => (ric ? ric(go, { timeout: 2500 }) : go()), 900)
})
useHead({ title: 'Kaduna Kulture - A Living Kaduna. An Economy Powered by Bitcoin.' })

const features = [
  {
    icon: '⚡',
    title: 'Bitcoin native, not bolted on',
    body:
      'An invoice is a request, never proof of payment. The backend verifies settlement against the Lightning node, then fulfills the purchase exactly once: idempotent, auditable, reconciled.'
  },
  {
    icon: '🤖',
    title: 'AI citizens with real limits',
    body:
      'Musa the shopkeeper reacts to live events through a validated tool registry: allowlisted, schema checked, economically bounded, with a full audit trail. No language model ever touches real money.'
  },
  {
    icon: '🏙️',
    title: 'A server-authoritative world',
    body:
      'Your browser renders the city, the server owns every sat, stock count, job and price. Drop your connection and the world resyncs itself the moment you are back.'
  }
]

const landmarks = [
  {
    icon: '🏪',
    name: "Musa's Provision Store",
    body: 'AI shopkeeper. Suya spice to power banks. Pay with Lightning, work deliveries for k-sats.'
  },
  {
    icon: '⚡',
    name: 'Arewa QuickPOS',
    body: 'Lightning point-of-service kiosk, the bridge between real sats and the simulation.'
  },
  {
    icon: '🧺',
    name: 'Kaduna Central Market',
    body: 'Market Rush events, vendor stalls, and the loudest haggling in the city.'
  },
  {
    icon: '🏛️',
    name: 'AREWA House',
    body: 'The city center landmark. Look for it when you spin the camera around.'
  },
  {
    icon: '🗿',
    name: 'Stonetech Square',
    body: "The gathering plaza, and Hajiya Amina's delivery drop-off."
  },
  {
    icon: '🛺',
    name: 'Keke Napep Stop',
    body: 'The transport network prototype. Grab a ride, or just enjoy the shade.'
  }
]
</script>

<template>
  <div class="min-h-screen bg-paper font-body text-ink">
    <!-- ============ hero: the live world ============ -->
    <section class="relative h-[100svh] min-h-[560px] overflow-hidden">
      <!-- live 3D neighborhood (no pointer capture: the page stays scrollable) -->
      <div class="pointer-events-none absolute inset-0">
        <div class="absolute inset-0 bg-gradient-to-b from-[#a7cbe0] via-[#c8ddba] to-paper" />
        <ClientOnly>
          <div v-if="showHero" class="kk-fade-in absolute inset-0"><HeroWorld /></div>
        </ClientOnly>
      </div>

      <!-- readability + blend into the next section -->
      <div class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/25 to-transparent" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-paper" />

      <!-- floating pill navbar -->
      <header class="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-3 sm:top-6">
        <nav
          class="pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-full border border-white/40 bg-white/80 py-2 pl-4 pr-2 shadow-lg shadow-ink/10 backdrop-blur-md"
        >
          <div class="flex items-center gap-2">
            <span class="flex h-9 w-9 items-center justify-center rounded-full bg-kadeep text-lg">🛺</span>
            <span class="font-display text-lg font-semibold tracking-tight">Kaduna Kulture</span>
          </div>
          <div class="flex items-center gap-2">
            <NuxtLink to="/game" class="kk-btn-ghost !py-2">Log in</NuxtLink>
            <NuxtLink to="/game?signup" class="kk-btn-primary !py-2">Play free</NuxtLink>
          </div>
        </nav>
      </header>

      <!-- floating CTA card, Lagos Life style -->
      <div class="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center px-3">
        <div
          class="pointer-events-auto w-[min(680px,94vw)] rounded-[2rem] border border-white/50 bg-white/85 p-7 text-center shadow-2xl shadow-ink/20 backdrop-blur-xl sm:p-9"
        >
          <div class="kk-chip mx-auto mb-3 border-kadeep/20 bg-kadeep/5 text-kadeep">
            <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-leaf"></span>
            The city is alive right now
          </div>
          <h1 class="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Live the city.
            <span class="text-leaf">Move real money.</span>
          </h1>
          <p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink/60 sm:text-base">
            A 3D life simulator of Kaduna in your browser. Walk the streets, take delivery jobs for
            k-sats, and shop from AI shopkeepers with Bitcoin Lightning. Every payment is verified
            server side, exactly once.
          </p>
          <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
            <NuxtLink to="/game?signup" class="kk-btn-primary !px-9 !py-3.5 !text-base">Create free account</NuxtLink>
            <NuxtLink to="/game" class="kk-btn-ghost !px-7 !py-3.5 !text-base">Log in</NuxtLink>
          </div>
          <div class="mt-4 text-xs text-ink/45">
            Free to play · no install, runs in your browser · just pick a username and password
          </div>
        </div>
      </div>
    </section>

    <!-- ============ pillars ============ -->
    <section class="mx-auto max-w-5xl px-4 pb-20 pt-14 sm:px-6">
      <div class="grid gap-4 sm:grid-cols-3">
        <div v-for="f in features" :key="f.title" class="kk-card">
          <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-kadeep/5 text-2xl">{{ f.icon }}</div>
          <div class="mb-1.5 font-display text-lg font-semibold">{{ f.title }}</div>
          <p class="text-sm leading-relaxed text-ink/60">{{ f.body }}</p>
        </div>
      </div>
    </section>

    <!-- ============ landmarks ============ -->
    <section class="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
      <div class="mb-5 flex items-end justify-between">
        <h2 class="font-display text-2xl font-semibold sm:text-3xl">Explore the neighborhood</h2>
        <span class="hidden text-sm text-ink/40 sm:block">every spot is interactive</span>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="l in landmarks" :key="l.name" class="kk-card !p-5">
          <div class="mb-2 flex items-center gap-2.5">
            <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-kasand/15 text-xl">{{ l.icon }}</span>
            <span class="font-display text-base font-semibold leading-tight">{{ l.name }}</span>
          </div>
          <p class="text-[13px] leading-relaxed text-ink/55">{{ l.body }}</p>
        </div>
      </div>
    </section>

    <!-- ============ honest footer ============ -->
    <section class="mx-auto max-w-5xl px-4 pb-14 sm:px-6">
      <div class="rounded-3xl border border-golddark/20 bg-kasand/10 p-6 text-sm leading-relaxed text-ink/70">
        <b class="text-ink">Demo economics:</b>
        Lightning invoices are real Lightning payments on the Bitcoin testnet, paid from your own
        testnet wallet: test sats have no market value, and mainnet is refused. k-sats are game currency and
        are never convertible to Bitcoin. Player withdrawals, custody and cash-out are deliberately
        out of scope pending security and legal review.
      </div>
      <div class="mt-10 text-center text-xs text-ink/35">
        Kaduna Kulture · made for the city that moves
      </div>
    </section>
  </div>
</template>

<style scoped>
.kk-fade-in {
  animation: kk-fade 1.2s ease-out both;
}
@keyframes kk-fade {
  from {
    opacity: 0;
  }
}
</style>
