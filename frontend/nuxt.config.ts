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
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&display=swap'
        }
      ]
    }
  },

  runtimeConfig: {
    public: {
      // Same-origin API via the gateway (or Nuxt devProxy in direct dev).
      apiBase: '/api/v1',
      wsPath: '/ws/game'
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
    devProxy: {
      '/api': { target: 'http://127.0.0.1:8000/api', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8000/ws', ws: true },
      '/lightning': { target: 'http://127.0.0.1:8000/lightning', changeOrigin: true }
    }
  },

  build: {
    transpile: ['three']
  },

  typescript: {
    strict: true,
    typeCheck: false
  }
})
