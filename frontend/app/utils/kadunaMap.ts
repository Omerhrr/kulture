// Shared 2D city map, prerendered once to an offscreen canvas and reused by
// the minimap (crop) and the full map overlay (scaled). North is up (-Z).
import { BAKE, BRIDGE_NAMES } from './kaduna'
import { IS_CITY } from './kaduna'
import { ROMI, TOWERS, FARMS, OPEN_HOUSES, mulberry32 } from './kadunaExtras'
import { ws } from './kaduna'

export const MAP_MARGIN = 90

export interface MapTransform {
  xmin: number
  zmin: number
  wUnits: number
  hUnits: number
  pxPerUnit: number
  pxW: number
  pxH: number
}

let _canvas: HTMLCanvasElement | null = null
let _t: MapTransform | null = null

export function mapTransform(): MapTransform {
  if (!_t) getMapCanvas()
  return _t!
}

let _bare: HTMLCanvasElement | null = null
/** labels=false returns the same map without text (for the zoomed-in minimap). */
export function getMapCanvas(labels = true): HTMLCanvasElement {
  if (_canvas) return labels ? _canvas : _bare!
  const b = BAKE.meta.bounds
  const wUnits = b.xmax - b.xmin + MAP_MARGIN * 2
  const hUnits = b.zmax - b.zmin + MAP_MARGIN * 2
  const pxW = 1500
  const pxH = Math.round((pxW * hUnits) / wUnits)
  const t: MapTransform = {
    xmin: b.xmin - MAP_MARGIN,
    zmin: b.zmin - MAP_MARGIN,
    wUnits,
    hUnits,
    pxPerUnit: pxW / wUnits,
    pxW,
    pxH
  }
  _t = t
  const X = (x: number) => (x - t.xmin) * t.pxPerUnit
  const Y = (z: number) => (z - t.zmin) * t.pxPerUnit
  const S = t.pxPerUnit

  const cv = document.createElement('canvas')
  cv.width = pxW
  cv.height = pxH
  const g = cv.getContext('2d')!

  // land
  g.fillStyle = '#87a55f'
  g.fillRect(0, 0, pxW, pxH)
  // subtle district tint variation
  // seeded so the map looks the same on every load (was Math.random)
  const rnd = mulberry32(0x6d4150)
  g.fillStyle = 'rgba(160,170,110,0.35)'
  for (let i = 0; i < 90; i++) {
    const x = rnd() * pxW
    const y = rnd() * pxH
    g.beginPath()
    g.ellipse(x, y, 60 + rnd() * 120, 40 + rnd() * 80, 0, 0, Math.PI * 2)
    g.fill()
  }

  // farms
  g.fillStyle = '#a9bf72'
  for (const f of FARMS) {
    g.fillRect(X(f.x) - 12 * S, Y(f.z) - 9.5 * S, 24 * S, 19 * S)
  }

  // water
  const strokeWater = (pts: [number, number][], wUnits: number, color: string) => {
    if (pts.length < 2) return
    g.strokeStyle = color
    g.lineWidth = Math.max(1.5, wUnits * S)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(X(pts[0][0]), Y(pts[0][1]))
    for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Y(pts[i][1]))
    g.stroke()
  }
  strokeWater(BAKE.river.main.slice(0, 400), BAKE.river.width * 2.0, '#5d87a3') // reservoir above the dam
  strokeWater(BAKE.river.main, BAKE.river.width, '#4f7d9a')
  for (const s of BAKE.river.side) strokeWater(s, BAKE.river.width * 0.7, '#4f7d9a')
  strokeWater(ROMI.pts, 4.6, '#4f7d9a')

  // rail
  g.setLineDash([6, 4])
  g.strokeStyle = '#4a4a52'
  g.lineWidth = 1.6
  for (const line of BAKE.rail) {
    g.beginPath()
    g.moveTo(X(line[0][0]), Y(line[0][1]))
    for (let i = 1; i < line.length; i++) g.lineTo(X(line[i][0]), Y(line[i][1]))
    g.stroke()
  }
  g.setLineDash([])

  // runway
  if (BAKE.airport.runway) {
    strokeWater(BAKE.airport.runway, 5.4, '#9a9a92')
  }

  // houses
  g.fillStyle = '#cfc0a0'
  for (const h of BAKE.houses) {
    const hw = Math.max(1, h[2] * S * 0.5)
    g.fillRect(X(h[0]) - hw, Y(h[1]) - hw, hw * 2, hw * 2)
  }

  // roads
  const roadStyle = (cls: string): [string, number] =>
    cls === 'trunk'
      ? ['#e8dcc0', 3.6]
      : cls === 'primary'
        ? ['#e8dcc0', 2.6]
        : cls === 'residential'
          ? ['#cdc4ae', 1.0]
          : ['#d4ccb8', 1.3]
  for (const r of BAKE.roads) {
    const [color, wpx] = roadStyle(r.class)
    g.strokeStyle = color
    g.lineWidth = wpx
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(X(r.pts[0][0]), Y(r.pts[0][1]))
    for (let i = 1; i < r.pts.length; i++) g.lineTo(X(r.pts[i][0]), Y(r.pts[i][1]))
    g.stroke()
  }

  // towers (tall buildings) on top of everything
  for (const tw of TOWERS) {
    g.fillStyle = '#3a4450'
    const s = Math.max(4, Math.max(tw.w, tw.d) * S)
    g.fillRect(X(tw.x) - s / 2, Y(tw.z) - s / 2, s, s)
    g.fillStyle = '#e8c84b'
    g.fillRect(X(tw.x) - 1.4, Y(tw.z) - 1.4, 2.8, 2.8)
  }

  // public buildings
  const CIV: Record<string, [string, string]> = { hospital: ['#d8262e', 'H'], school: ['#2f7d5b', 'S'], fuel: ['#e0a020', 'F'], mechanic: ['#6b6f75', 'M'] }
  g.font = '800 9px "Nunito", sans-serif'
  g.textAlign = 'center'
  for (const c of BAKE.civic ?? []) {
    const [col, ch] = CIV[c.kind]
    g.fillStyle = col
    g.beginPath()
    g.arc(X(c.x), Y(c.z), c.kind === 'mechanic' ? 3.2 : 5, 0, Math.PI * 2)
    g.fill()
    if (c.kind !== 'mechanic') {
      g.fillStyle = '#ffffff'
      g.fillText(ch, X(c.x), Y(c.z) + 3.2)
    }
  }

  // bridges
  g.fillStyle = '#f0eee6'
  for (const b of BAKE.bridges) {
    g.fillRect(X(b.x) - 3, Y(b.z) - 3, 6, 6)
  }

  // open (enterable) houses
  g.fillStyle = '#d8b13c'
  for (const oh of OPEN_HOUSES) {
    g.beginPath()
    g.arc(X(oh.x), Y(oh.z), 4, 0, Math.PI * 2)
    g.fill()
  }

  // text-free copy for the minimap, where big labels clip and clutter
  _bare = document.createElement('canvas')
  _bare.width = cv.width
  _bare.height = cv.height
  _bare.getContext('2d')!.drawImage(cv, 0, 0)

  // landmark markers + names
  g.font = '600 15px "Nunito", sans-serif'
  g.textAlign = 'center'
  for (const lm of BAKE.landmarks) {
    if (lm.kind === 'label') continue
    g.fillStyle = '#3a3f36'
    g.beginPath()
    g.arc(X(lm.x), Y(lm.z), 3.4, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.92)'
    g.strokeStyle = 'rgba(30,40,30,0.55)'
    g.lineWidth = 3
    g.strokeText(lm.name, X(lm.x), Y(lm.z) - 8)
    g.fillText(lm.name, X(lm.x), Y(lm.z) - 8)
  }
  // neighborhood labels (smaller, only on the big map)
  g.font = '500 13px "Nunito", sans-serif'
  g.fillStyle = 'rgba(250,250,240,0.66)'
  for (const p of BAKE.places) {
    g.fillText(p.name, X(p.x), Y(p.z) + 4)
  }
  // river + dam labels
  g.fillStyle = '#dceef5'
  g.font = '600 14px "Nunito", sans-serif'
  if (IS_CITY) g.fillText('River Kaduna', X(ws(320)), Y(ws(-24)))
  if (ROMI.pts[3]) g.fillText('Romi Stream', X(ROMI.pts[3][0]), Y(ROMI.pts[3][1]))

  _canvas = cv
  return labels ? cv : _bare
}

/** World -> map pixel coordinates. */
export function worldToMap(x: number, z: number): [number, number] {
  const t = mapTransform()
  return [(x - t.xmin) * t.pxPerUnit, (z - t.zmin) * t.pxPerUnit]
}

/** Map pixel -> world coordinates. */
export function mapToWorld(px: number, py: number): [number, number] {
  const t = mapTransform()
  return [px / t.pxPerUnit + t.xmin, py / t.pxPerUnit + t.zmin]
}
