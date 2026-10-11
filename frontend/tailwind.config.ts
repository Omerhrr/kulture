import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  content: [],
  theme: {
    extend: {
      colors: {
        kadeep: '#0B3D2E', // deep kraft green (primary)
        leaf: '#1F7A4D', // action green (hover / accents)
        kasand: '#E8B84B', // sand gold (brand accent)
        golddark: '#A87B1F', // gold that reads on light backgrounds
        katerr: '#7C4A2D', // terracotta
        kakano: '#1A2E35', // legacy charcoal (world props)
        kacream: '#F7F1E3', // legacy cream (world props)
        paper: '#FBF6EB', // warm cream page background
        ink: '#1C2B25' // deep green-black text
      },
      fontFamily: {
        display: ['Fredoka', 'Nunito', 'system-ui', 'sans-serif'],
        body: ['Nunito', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif']
      }
    }
  }
}
