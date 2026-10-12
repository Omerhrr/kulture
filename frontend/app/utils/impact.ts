// Physical impacts shared between systems: camera shake, the player being
// knocked down by a vehicle, and crash events. Plain module state, read
// every frame by CameraRig / PlayerAvatar / RideSystem.

export const impact = {
  /** camera shake energy (0..~1.5), decays every frame */
  shake: 0,
  /** player knocked off their feet: horizontal velocity + timers */
  knock: {
    active: false,
    vx: 0,
    vz: 0,
    vy: 0,
    y: 0,
    /** seconds since the hit */
    t: 0,
    /** spin direction for the tumble */
    spin: 1
  },
  /** last crash strength (0..1) for HUD flash */
  lastCrash: 0,
  lastCrashAt: 0
}

/** Add camera shake (strength ~0.2 bump .. 1.2 heavy crash). */
export function addShake(strength: number) {
  impact.shake = Math.min(1.6, impact.shake + strength)
}

/**
 * Knock the player down: `dirX/dirZ` is the direction of the push (unit),
 * `speed` the hitting vehicle's speed in m/s.
 */
export function knockPlayer(dirX: number, dirZ: number, speed: number) {
  const k = impact.knock
  if (k.active && k.t < 0.4) return
  const s = Math.min(14, 2.5 + speed * 0.55)
  k.active = true
  k.vx = dirX * s
  k.vz = dirZ * s
  k.vy = Math.min(5.5, 1.5 + speed * 0.18)
  k.y = 0
  k.t = 0
  k.spin = Math.random() < 0.5 ? -1 : 1
  impact.lastCrash = Math.min(1, speed / 18)
  impact.lastCrashAt = performance.now()
  addShake(0.5 + Math.min(1, speed / 15))
}

export function registerCrash(strength: number) {
  impact.lastCrash = strength
  impact.lastCrashAt = performance.now()
  addShake(0.25 + strength * 1.1)
}

/** Melee hits thrown by the player (punch / kick / push), consumed by the
 *  crowd each frame: anyone in reach gets knocked back. */
export interface MeleeHit {
  x: number
  z: number
  dirX: number
  dirZ: number
  power: number
  reach: number
}
export const meleeHits: MeleeHit[] = []
export function throwMelee(h: MeleeHit) {
  meleeHits.push(h)
  if (meleeHits.length > 8) meleeHits.shift()
}

/** Named characters (Musa, Mama Chidi, ...) register a body here so melee
 *  and vehicle impacts can land on them directly - no queues, no frame
 *  sync: each impact sweeps the registry and those in reach react. */
export interface NamedBody {
  code: string
  x: () => number
  z: () => number
  /** apply the impact; return false if already busy (down / mid-fight) */
  hit: (dirX: number, dirZ: number, power: number) => boolean
}
const namedBodies: NamedBody[] = []
export function registerNamed(b: NamedBody): () => void {
  namedBodies.push(b)
  return () => {
    const i = namedBodies.indexOf(b)
    if (i >= 0) namedBodies.splice(i, 1)
  }
}
/** Sweep every named character with one melee impact (a punch, a car).
 *  Returns true when at least one of them took it. */
export function hitNamed(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  power: number,
  reach: number
): boolean {
  let landed = false
  for (const b of namedBodies) {
    const dx = b.x() - x
    const dz = b.z() - z
    const d = Math.hypot(dx, dz)
    if (d < reach && dx * dirX + dz * dirZ > -0.35) {
      if (b.hit(dirX, dirZ, power)) landed = true
    }
  }
  return landed
}

/** Live-state snapshots for headless tests (NpcAvatar pushes a getter). */
export const namedDebug: Array<() => any> = []
