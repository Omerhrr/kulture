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
    pitch: 0.32,
    dist: 8.5
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

// ------------------------------------------------------------------ riding
export type RideKind = 'keke' | 'car' | 'okada' | 'bus' | 'truck' | 'bicycle' | 'boat' | 'plane'

export interface RideState {
  active: boolean
  kind: RideKind | null
  name: string
  /** true = cockpit view, false = outer chase view */
  inner: boolean
  /** board prompt for the nearest parked vehicle (null when none close) */
  prompt: string | null
  /** mph-style speed readout for the HUD */
  speed: number
}

export function useRide() {
  return useState<RideState>('kk_ride', () => ({
    active: false,
    kind: null,
    name: '',
    inner: false,
    prompt: null,
    speed: 0
  }))
}

// ------------------------------------------------------------------ interiors
export interface InteriorState {
  /** true once the player walked through a door */
  inside: boolean
  name: string
  /** venue type (bar, cinema, restaurant...) when inside a public venue */
  venue?: string
  /** room centre + rotation (world) */
  cx?: number
  cz?: number
  rot?: number
}

export function useInterior() {
  return useState<InteriorState>('kk_interior', () => ({ inside: false, name: '' }))
}

/** Nearest door prompt (enter a house / exit to the street), set by Interiors. */
export function useDoorPrompt() {
  return useState<{ label: string; action: 'enter' | 'exit' | 'use'; slot: number; button?: string } | null>(
    'kk_door_prompt',
    () => null
  )
}

/** Pose override for the player avatar while using furniture (sit on sofa...). */
export function usePlayerPose() {
  return useState<null | string>('kk_player_pose', () => null)
}

// ------------------------------------------------------------------ city map
/** 3D city map (tilted overview of the live city). focus = ground point the
 *  map camera looks at; dist = zoom. */
export interface CityMapState {
  active: boolean
  fx: number
  fz: number
  dist: number
  yaw: number
}
export function useCityMap() {
  return useState<CityMapState>('kk_citymap', () => ({ active: false, fx: 0, fz: 0, dist: 420, yaw: 0.35 }))
}

// ------------------------------------------------------------------ map
export function useMapOpen() {
  return useState<boolean>('kk_map_open', () => false)
}

/** Board/exit action requests are dispatched as DOM events so key and touch
 *  paths stay symmetric with the interact flow. */
export function fireKkEvent(name: string) {
  if (import.meta.client) window.dispatchEvent(new CustomEvent(name))
}

/** Camera view: third person (behind), first person (through your eyes),
 *  second person (in front, looking back at you). Remembered per browser. */
export type CamMode = 'third' | 'first' | 'second'
export const CAM_MODES: CamMode[] = ['third', 'first', 'second']
export const CAM_LABEL: Record<CamMode, string> = { third: '3rd person', first: '1st person', second: '2nd person' }
export function useCamMode() {
  return useState<CamMode>('kk_cam_mode', () => {
    try {
      const m = localStorage.getItem('kk_cam_mode') as CamMode | null
      if (m && CAM_MODES.includes(m)) return m
    } catch {}
    return 'third'
  })
}
export function cycleCamMode(mode: Ref<CamMode>) {
  mode.value = CAM_MODES[(CAM_MODES.indexOf(mode.value) + 1) % CAM_MODES.length]!
  try {
    localStorage.setItem('kk_cam_mode', mode.value)
  } catch {}
}
