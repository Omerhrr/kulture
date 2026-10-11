<script setup lang="ts">
useHead({ title: 'Kaduna Kulture — A Living Kaduna. An Economy Powered by Bitcoin.' })
</script>

<template>
  <div class="min-h-screen bg-kakano text-kacream">
    <!-- hero -->
    <header class="relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br from-kadeep/70 via-kakano to-kakano" />
      <div class="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-kasand/10 blur-3xl" />
      <div class="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-katerr/20 blur-3xl" />

      <div class="relative mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
        <div class="kk-chip mx-auto mb-6 border-kasand/40 text-kasand">
          🇳🇬 Bitcoin Build-Athon 2026 · Oct 29 — DevFest Kaduna City · Oct 31
        </div>
        <h1 class="text-5xl font-black leading-tight sm:text-7xl">
          Kaduna <span class="text-kasand">Kulture</span>
        </h1>
        <p class="mx-auto mt-4 max-w-2xl text-lg text-white/70">
          A living Kaduna. An economy powered by Bitcoin. A 3D browser life-simulator where AI
          citizens run businesses, players take delivery jobs, and every real purchase settles
          through <b class="text-kasand">Lightning</b> — verified server-side, exactly once.
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <NuxtLink to="/game" class="kk-btn-primary !px-8 !py-3 !text-base">
            🛺 Enter the world
          </NuxtLink>
          <a href="/api/docs" target="_blank" class="kk-btn-ghost !px-6 !py-3">API docs</a>
        </div>
        <div class="mt-4 text-xs text-white/40">
          Demo account: <code class="text-kasand">demo_player</code> /
          <code class="text-kasand">kaduna-demo-2026</code>
        </div>
      </div>
    </header>

    <!-- pillars -->
    <section class="mx-auto grid max-w-5xl gap-4 px-6 pb-16 sm:grid-cols-3">
      <div class="kk-panel p-5">
        <div class="mb-2 text-3xl">⚡</div>
        <div class="mb-1 font-bold text-kasand">Bitcoin-native, not bolted-on</div>
        <p class="text-sm leading-relaxed text-white/60">
          An invoice is a request, never proof of payment. The backend verifies settlement against
          the Lightning node, then fulfills the purchase exactly once — idempotent, auditable,
          reconciled.
        </p>
      </div>
      <div class="kk-panel p-5">
        <div class="mb-2 text-3xl">🤖</div>
        <div class="mb-1 font-bold text-kasand">Bounded AI citizens</div>
        <p class="text-sm leading-relaxed text-white/60">
          The DSH shopkeeper reacts to real events through a validated tool registry — allowlisted,
          schema-checked, economically bounded, with a full audit trail. No LLM ever touches real
          money.
        </p>
      </div>
      <div class="kk-panel p-5">
        <div class="mb-2 text-3xl">🏙️</div>
        <div class="mb-1 font-bold text-kasand">Authoritative world</div>
        <p class="text-sm leading-relaxed text-white/60">
          Nuxt + TresJS render the city; FastAPI owns every sat, stock count, job, and price.
          Reconnect-safe WebSockets resync authoritative state on drop.
        </p>
      </div>
    </section>

    <!-- landmarks -->
    <section class="mx-auto max-w-5xl px-6 pb-16">
      <div class="kk-panel p-6">
        <div class="mb-4 text-sm uppercase tracking-widest text-white/40">Explore the neighborhood</div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div class="rounded-lg border border-white/10 bg-white/5 p-4">
            <div class="font-semibold text-kasand">🏪 Musa's Provision Store</div>
            <p class="mt-1 text-xs text-white/55">AI shopkeeper. Suya spice to power banks. Pay with Lightning, work deliveries for NGN.</p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/5 p-4">
            <div class="font-semibold text-kasand">⚡ Arewa QuickPOS</div>
            <p class="mt-1 text-xs text-white/55">Lightning point-of-service kiosk — the bridge between real sats and the sim.</p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/5 p-4">
            <div class="font-semibold text-kasand">🧺 Kaduna Central Market</div>
            <p class="mt-1 text-xs text-white/55">Market Rush events, vendor stalls, and the loudest haggling in the sim.</p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/5 p-4">
            <div class="font-semibold text-kasand">🏛️ AREWA House</div>
            <p class="mt-1 text-xs text-white/55">The city-center landmark. DevFest energy lives here.</p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/5 p-4">
            <div class="font-semibold text-kasand">🗿 Stonetech Square</div>
            <p class="mt-1 text-xs text-white/55">Build-Athon gathering point — and Hajiya Amina's delivery drop-off.</p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/5 p-4">
            <div class="font-semibold text-kasand">🛺 Keke Napep Stop</div>
            <p class="mt-1 text-xs text-white/55">Transport network prototype. Danfo routes coming post-hackathon.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- disclaimers -->
    <section class="mx-auto max-w-5xl px-6 pb-20">
      <div class="rounded-xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm leading-relaxed text-amber-200/80">
        <b>Demo economics:</b> Lightning invoices are real Bitcoin (sats) paid from your own wallet —
        in this build they run against a regtest-style simulator, so no real funds move. Simulated
        NGN is game currency and is <b>never</b> convertible to Bitcoin. Player withdrawals,
        custody, and cash-out are deliberately out of scope pending security and legal review.
      </div>
      <div class="mt-8 text-center text-xs text-white/30">
        Open source · Nuxt 3 + TresJS + FastAPI + PostgreSQL + Lightning (LDK-ready) + DSH agents
      </div>
    </section>
  </div>
</template>
