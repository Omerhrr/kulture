// Shared bits for the phone arcade games: an input pad that both the
// keyboard and the on-screen buttons write to, a fixed-size canvas loop,
// and a tiny seeded RNG. Every game is original (names + art drawn in code).

export interface Pad {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  a: boolean // jump / punch / rotate
  b: boolean // kick / special / drop
  /** one-shot presses since the game last read them */
  pressed: Set<string>
}

export function makePad(): Pad {
  return { left: false, right: false, up: false, down: false, a: false, b: false, pressed: new Set() }
}

const KEYMAP: Record<string, keyof Omit<Pad, 'pressed'>> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyJ: 'a', Space: 'a', KeyZ: 'a',
  KeyK: 'b', KeyX: 'b', Enter: 'b'
}

/** Wire the keyboard to a pad; returns an unbind function. */
export function bindKeys(pad: Pad): () => void {
  const down = (e: KeyboardEvent) => {
    const k = KEYMAP[e.code]
    if (!k) return
    e.preventDefault()
    e.stopPropagation()
    if (!pad[k]) pad.pressed.add(k)
    pad[k] = true
  }
  const up = (e: KeyboardEvent) => {
    const k = KEYMAP[e.code]
    if (!k) return
    e.preventDefault()
    pad[k] = false
  }
  window.addEventListener('keydown', down, true)
  window.addEventListener('keyup', up, true)
  return () => {
    window.removeEventListener('keydown', down, true)
    window.removeEventListener('keyup', up, true)
  }
}

export function took(pad: Pad, k: string): boolean {
  if (!pad.pressed.has(k)) return false
  pad.pressed.delete(k)
  return true
}

/** requestAnimationFrame loop with a clamped dt (seconds). Returns stop(). */
export function runLoop(step: (dt: number, t: number) => void): () => void {
  let raf = 0
  let last = performance.now()
  const tick = () => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    step(dt, now / 1000)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

export function rng(seed = Date.now() % 2147483647) {
  let s = seed || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

export const ARCADE_GAMES = [
  { id: 'snake', name: 'Mango Snake', icon: '🐍', blurb: 'Eat the mangoes, don’t bite your tail.' },
  { id: 'runner', name: 'Mallam Run', icon: '🏃', blurb: 'Run, jump on goats, grab the coins, reach the flag.' },
  { id: 'brawl', name: 'Kaduna Street Brawl', icon: '🥊', blurb: 'Best of 3 rounds. Punch, kick, block, suya fireball.' },
  { id: 'stick', name: 'Stick Clash', icon: '🤺', blurb: 'Knock the other stickman off the roof.' },
  { id: 'okada', name: 'Okada Dash', icon: '🏍️', blurb: 'Weave through Kaduna traffic. How far can you go?' },
  { id: 'blocks', name: 'Block Mason', icon: '🧱', blurb: 'Stack the falling blocks, clear full rows.' }
] as const
export type ArcadeId = (typeof ARCADE_GAMES)[number]['id']
