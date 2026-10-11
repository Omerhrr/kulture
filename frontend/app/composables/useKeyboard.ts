// Module-scope keyboard state shared across components (client only).

const pressed = new Set<string>()
let installed = false

export function useKeyboard() {
  if (typeof window !== 'undefined' && !installed) {
    installed = true
    window.addEventListener('keydown', (e) => {
      pressed.add(e.code)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => pressed.delete(e.code))
    window.addEventListener('blur', () => pressed.clear())
  }

  const isDown = (...codes: string[]) => codes.some((c) => pressed.has(c))
  return { isDown }
}
