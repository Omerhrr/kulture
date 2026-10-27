// Shared vehicle traffic probe. TrafficSystem fills this every frame with
// the live positions and speeds of every ambient vehicle; CrowdSystem reads
// it so pedestrians wait for gaps at crossings and dodge moving traffic.
// A plain module singleton (no reactivity) keeps the per-frame cost zero.

export interface ProbeVehicle {
  x: number
  z: number
  /** current speed, units/s */
  v: number
  /** heading (rad, atan2(fx, fz) convention) */
  h: number
  /** collision radius */
  r: number
  /** body half-length / half-width (oriented footprint); default r */
  hl?: number
  hw?: number
}

export const trafficProbe = {
  cars: [] as ProbeVehicle[],
  /** pedestrians near the player (x, z pairs), refreshed by the crowd */
  peds: [] as Array<{ x: number; z: number }>,
  /** parked / boardable vehicles (static, registered once by RideSystem):
   *  ambient traffic brakes for these instead of driving through them */
  parked: [] as Array<{ x: number; z: number; r: number }>,
  /** the player's active vehicle (or null on foot) */
  player: null as ProbeVehicle | null,
  /** true when the player rides something fast enough to dodge from */
  playerSpeed: 0
}

/** Clear the probe each frame (TrafficSystem calls this first). */
export function probeReset() {
  trafficProbe.cars.length = 0
}

export function probePush(x: number, z: number, v: number, h: number, r: number, hl?: number, hw?: number) {
  const cars = trafficProbe.cars
  if (cars.length >= 220) return
  cars.push({ x, z, v, h, r, hl, hw })
}

/**
 * Nearest oncoming or passing vehicle within (ahead, side) of a walker at
 * (x, z) moving along (dx, dz). Returns its speed, or -1 when the lane is
 * clear. Used at crosswalks: wait until it returns -1.
 */
export function laneBlocked(x: number, z: number, reach: number): number {
  let fastest = -1
  for (const c of trafficProbe.cars) {
    const d = Math.hypot(c.x - x, c.z - z)
    if (d < reach && c.v > 0.6) {
      if (c.v > fastest) fastest = c.v
    }
  }
  return fastest
}

/** True when any vehicle (or the player's ride) threatens a walker. */
export function threatNear(x: number, z: number, radius: number): number {
  let threat = 0
  for (const c of trafficProbe.cars) {
    if (c.v < 1.2) continue
    const d = Math.hypot(c.x - x, c.z - z)
    if (d < radius) threat = Math.max(threat, 1 - d / radius)
  }
  const p = trafficProbe.player
  if (p && trafficProbe.playerSpeed > 3) {
    const d = Math.hypot(p.x - x, p.z - z)
    if (d < radius * 1.4) threat = Math.max(threat, 1.2 * (1 - d / (radius * 1.4)))
  }
  return threat
}
