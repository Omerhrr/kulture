// Module-scope keyboard state shared across components (client only).
//
// Hardened input layer:
// - Tracks BOTH e.code (physical) and normalized e.key (layout-proof), so
//   arrows, WASD and ZQSD-style layouts all work.
// - Capture-phase listeners on window so nothing can stop us from seeing keys.
// - Auto-repeat dedup, blur/visibility clearing (no stuck keys), and a guard
//   that ignores game keys while the user types in inputs.

const pressed = new Set<string>()
let installed = false

function normalize(e: KeyboardEvent): string[] {
  const keys: string[] = []
  if (e.code) keys.push(e.code)
  if (e.key) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    keys.push(k)
  }
  return keys
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true
}

export function useKeyboard() {
  if (typeof window !== 'undefined' && !installed) {
    installed = true
    window.addEventListener(
      'keydown',
      (e) => {
        if (isTypingTarget(e)) return
        // dev-only escape hatch for automated tests
        if (import.meta.dev) {
          ;(window as any).__kk_last_key = e.code || e.key
        }
        for (const k of normalize(e)) pressed.add(k)
        // keep the viewport from scrolling while piloting the character
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault()
        }
      },
      { capture: true }
    )
    window.addEventListener(
      'keyup',
      (e) => {
        for (const k of normalize(e)) pressed.delete(k)
      },
      { capture: true }
    )
    const clearAll = () => pressed.clear()
    window.addEventListener('blur', clearAll)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearAll()
    })
    // Focus landing in a form field must not leave stale movement keys held.
    window.addEventListener('focusin', (e) => {
      if (isTypingTarget(e as KeyboardEvent)) clearAll()
    })

    if (import.meta.dev) {
      ;(window as any).__kk_keys = () => [...pressed]
    }
  }

  /** True when ANY of the given tokens is currently held. */
  const isDown = (...tokens: string[]) => tokens.some((t) => pressed.has(t))
  return { isDown }
}
