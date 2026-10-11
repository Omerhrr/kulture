// Shared player steering + camera view state.
//
// - kk_move_target: click-to-move destination on the ground plane. Keyboard
//   and joystick input always override it; arrival clears it.
// - kk_cam_orbit: user-controlled orbit (yaw/pitch radians + distance units).
//   The camera rig smoothly follows these plus the player position.
// - kk_touch_move: virtual joystick vector for touch devices ({x, y, active});
//   x is screen-right, y is screen-up (both -1..1), camera-relative in use.

export type MoveTarget = { x: number; z: number } | null

export function useMoveTarget() {
  return useState<MoveTarget>('kk_move_target', () => null)
}

export function useCamOrbit() {
  return useState<{ yaw: number; pitch: number; dist: number }>('kk_cam_orbit', () => ({
    yaw: 0,
    pitch: 0.58,
    dist: 20
  }))
}

export function useTouchMove() {
  return useState<{ x: number; y: number; active: boolean }>('kk_touch_move', () => ({
    x: 0,
    y: 0,
    active: false
  }))
}

/** Coarse-pointer (touch) device detection, evaluated once per client.
 *  ?touch=1 forces touch mode (desktop testing of the mobile UI). */
export function useIsTouch() {
  const touch = useState<boolean>('kk_is_touch', () => false)
  const w = window as unknown as { __kk_touch_checked?: boolean }
  if (import.meta.client && !w.__kk_touch_checked) {
    w.__kk_touch_checked = true
    const forced = new URLSearchParams(window.location.search).has('touch')
    touch.value =
      forced ||
      window.matchMedia('(pointer: coarse)').matches ||
      'ontouchstart' in window
  }
  return touch
}
