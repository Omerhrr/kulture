// Per-frame vehicle pose shared between RideSystem (writer) and the
// camera rig / HUD (readers). Plain mutable object on purpose: updating a
// useState 60x/s would trigger reactivity for values nobody renders.
export interface RidePose {
  x: number
  y: number // vehicle body height (boat bobs, plane climbs)
  z: number
  heading: number // radians, 0 = facing +Z... kept in sync with avatar facing convention
  speed: number // units/s
  cabin: number // height of the cockpit eye above the ground
  cockpitFwd: number // cockpit eye offset forward from vehicle center
  active: boolean
}

export const ridePose: RidePose = {
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 0,
  cabin: 1.6,
  cockpitFwd: 0.4,
  active: false
}
