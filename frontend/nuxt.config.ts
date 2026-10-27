export default defineNuxtConfig({
  srcDir: 'app/',
  compatibilityDate: '2025-07-01',
  devtools: { enabled: false },

  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@tresjs/nuxt'],

  components: [{ path: '~/components', pathPrefix: false }],

  app: {
    head: {
      title: 'Kaduna Kulture - A Living Kaduna. An Economy Powered by Bitcoin.',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
        {
          name: 'description',
          content:
            'A 3D browser life simulator of Kaduna with a Bitcoin Lightning economy. Walk the city, take delivery jobs, shop from AI shopkeepers, pay with real sats.'
        }
      ],
      // fonts: self-hosted via @fontsource (see assets/css/tailwind.css)
      link: []
    }
  },

  runtimeConfig: {
    public: {
      // Same-origin API via the gateway (or Nuxt devProxy in direct dev).
      apiBase: '/api/v1',
      wsPath: '/ws/game',
      // Origin for the game WebSocket, e.g. "wss://kulture.example". Empty =
      // same origin (gateway / Caddy). In `nuxt dev` an empty value means the
      // FastAPI backend on this host's :8000, because the dev proxy below
      // cannot carry WebSocket upgrades. Override: NUXT_PUBLIC_WS_BASE.
      wsBase: ''
    }
  },

  // Dev-server host allowlist: the sandbox preview routes the app through
  // platform-specific domains (e.g. *.fcapp.run), so the Vite host check must
  // not block them. Dev-only, production serves a nitro build (no check).
  vite: {
    server: {
      allowedHosts: true
    }
  },

  // Direct-dev convenience: when Nuxt runs alone (no gateway), proxy API + WS
  // to the FastAPI backend. In production the gateway/Caddy owns this route.
  nitro: {
    // 3D models and other public files keep their names between deploys:
    // cache them for a week so returning players don't re-download them
    // (the hashed /_nuxt/ bundles are already cached forever).
    routeRules: {
      // (typed loosely: this nitro version's route-rule types omit `headers`, which it does honour)
      '/models/**': { headers: { 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400' } } as any
    },
    devProxy: {
      '/api': { target: 'http://127.0.0.1:8000/api', changeOrigin: true },
      // no '/ws' entry: nitro's dev proxy drops WebSocket upgrades (they fell
      // through to the Vue router and crashed the dev server with ECONNRESET);
      // the client dials the backend directly in dev instead (see wsBase).
      '/lightning': { target: 'http://127.0.0.1:8000/lightning', changeOrigin: true }
    }
  },

  build: {
    transpile: ['three']
  },

  // Don't <link rel="prefetch"> every lazily-loaded chunk: by default Nuxt
  // hints all of them, so phones download the physics engine (football) and
  // the character-creator's 3D engine (~1.2 MB) while the game itself is
  // still loading. They're fetched when actually used instead.
  hooks: {
    'build:manifest'(manifest) {
      for (const entry of Object.values(manifest)) {
        entry.prefetch = false
        if (entry.dynamicImports) entry.dynamicImports = []
      }
    }
  },



  typescript: {
    strict: true,
    typeCheck: false
  }
})
