// Shared player steering + camera view state.
//
// - kk_move_target: click-to-move destination on the ground plane. Keyboard
//   input always overrides it; arrival clears it.
// - kk_cam_orbit: user-controlled orbit (yaw/pitch radians + distance units).
//   The camera rig smoothly follows these plus the player position.

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
