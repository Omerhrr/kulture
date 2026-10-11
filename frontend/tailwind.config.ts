import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  content: [],
  theme: {
    extend: {
      colors: {
        kadeep: '#0B3D2E',      // deep kraft green
        kasand: '#E8B84B',      // sand gold
        katerr: '#7C4A2D',      // terracotta
        kakano: '#1A2E35',      // charcoal blue
        kacream: '#F7F1E3'      // cream
      },
      fontFamily: {
        display: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif']
      }
    }
  }
}
