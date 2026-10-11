export default defineNuxtConfig({
  srcDir: 'app/',
  compatibilityDate: '2025-07-01',
  devtools: { enabled: false },

  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@tresjs/nuxt'],

  components: [{ path: '~/components', pathPrefix: false }],

  app: {
    head: {
      title: 'Kaduna Kulture — A Living Kaduna. An Economy Powered by Bitcoin.',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1' },
        {
          name: 'description',
          content:
            'A 3D browser-based Kaduna life simulator with a Bitcoin Lightning-native economy. AI shopkeepers, real sats, real settlement.'
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
