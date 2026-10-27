<script setup lang="ts">
// LudoBoard - the classic 15 x 15 board for the server's Ludo state
// (backend games_engine): token progress -1 = in the yard, 0..50 round the
// track from the seat's start square, 51..56 up its home column, 57 home.
// Seat s starts 13 squares after seat s-1 (left, top, right, bottom arms).
const props = defineProps<{ players: string[]; tokens: Record<string, number[]>; you: number; movable: number[]; names: Record<string, string> }>()
const emit = defineEmits<{ move: [token: number] }>()

const COLORS = ['#e11d48', '#16a34a', '#2563eb', '#eab308']
const LIGHT = ['#fecdd3', '#bbf7d0', '#bfdbfe', '#fef08a']
// the 52 track squares clockwise from seat 0's start (left arm)
const TRACK: [number, number][] = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0],
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7],
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14],
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6]
]
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47])
// home columns (progress 51..56) per seat
const HOME: [number, number][][] = [
  [1, 2, 3, 4, 5, 6].map((x) => [x, 7]),
  [1, 2, 3, 4, 5, 6].map((y) => [7, y]),
  [13, 12, 11, 10, 9, 8].map((x) => [x, 7]),
  [13, 12, 11, 10, 9, 8].map((y) => [7, y])
]
// yards: top-left, top-right, bottom-right, bottom-left; four spots each
const YARD: [number, number][] = [[0, 0], [9, 0], [9, 9], [0, 9]]
const yardSpot = (seat: number, i: number): [number, number] => [YARD[seat]![0] + 1.5 + (i % 2) * 3, YARD[seat]![1] + 1.5 + Math.floor(i / 2) * 3]

function cell(seat: number, p: number): [number, number] {
  if (p >= 57) return [7, 7]
  if (p > 50) return HOME[seat]![p - 51]!
  return TRACK[(13 * seat + p) % 52]!
}
interface Tok { key: string; seat: number; i: number; x: number; y: number; can: boolean }
const toks = computed<Tok[]>(() => {
  const out: Tok[] = []
  props.players.forEach((pid, seat) => {
    ;(props.tokens[pid] ?? []).forEach((p, i) => {
      const [x, y] = p < 0 ? yardSpot(seat, i) : cell(seat, p)
      out.push({ key: `${seat}-${i}`, seat, i, x: p < 0 ? x : x + 0.5, y: p < 0 ? y : y + 0.5, can: seat === props.you && props.movable.includes(i) })
    })
  })
  // tokens sharing a square fan out a little
  const seen = new Map<string, number>()
  for (const t of out) {
    const k = `${t.x},${t.y}`
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    if (n) {
      t.x += ((n % 2) - 0.5) * 0.36
      t.y += (n > 1 ? 0.18 : -0.18)
    }
  }
  return out
})
const startOf = (seat: number) => TRACK[(13 * seat) % 52]!
</script>

<template>
  <svg viewBox="0 0 15 15" class="w-full rounded-2xl bg-white shadow-inner" role="img" aria-label="Ludo board">
    <!-- yards -->
    <g v-for="(y, s) in YARD" :key="'yard' + s">
      <rect :x="y[0]" :y="y[1]" width="6" height="6" :fill="COLORS[s]" rx="0.3" />
      <rect :x="y[0] + 0.8" :y="y[1] + 0.8" width="4.4" height="4.4" fill="#fff" rx="0.4" />
      <circle v-for="i in 4" :key="i" :cx="yardSpot(s, i - 1)[0]" :cy="yardSpot(s, i - 1)[1]" r="0.62" :fill="LIGHT[s]" :stroke="COLORS[s]" stroke-width="0.08" />
      <text v-if="players[s]" :x="y[0] + 3" :y="y[1] + 3.15" text-anchor="middle" font-size="0.62" font-weight="700" :fill="COLORS[s]">{{ (names[players[s]!] ?? '').slice(0, 9) }}</text>
    </g>
    <!-- track -->
    <rect v-for="(c, i) in TRACK" :key="'t' + i" :x="c[0]" :y="c[1]" width="1" height="1" :fill="SAFE.has(i) ? '#f1f5f9' : '#fff'" stroke="#cbd5e1" stroke-width="0.04" />
    <text v-for="i in [8, 21, 34, 47]" :key="'star' + i" :x="TRACK[i]![0] + 0.5" :y="TRACK[i]![1] + 0.72" text-anchor="middle" font-size="0.62" fill="#94a3b8">★</text>
    <!-- start squares + home columns -->
    <g v-for="s in 4" :key="'home' + s">
      <rect :x="startOf(s - 1)[0]" :y="startOf(s - 1)[1]" width="1" height="1" :fill="COLORS[s - 1]" opacity="0.85" />
      <rect v-for="(h, j) in HOME[s - 1]" :key="j" :x="h[0]" :y="h[1]" width="1" height="1" :fill="COLORS[s - 1]" opacity="0.55" stroke="#fff" stroke-width="0.04" />
    </g>
    <!-- centre -->
    <polygon points="6,6 7.5,7.5 6,9" :fill="COLORS[0]" />
    <polygon points="6,6 9,6 7.5,7.5" :fill="COLORS[1]" />
    <polygon points="9,6 9,9 7.5,7.5" :fill="COLORS[2]" />
    <polygon points="6,9 7.5,7.5 9,9" :fill="COLORS[3]" />
    <!-- tokens -->
    <g v-for="t in toks" :key="t.key" :transform="`translate(${t.x} ${t.y})`" class="transition-transform duration-300" :class="t.can ? 'cursor-pointer' : ''" @click="t.can && emit('move', t.i)">
      <circle v-if="t.can" r="0.55" fill="none" :stroke="COLORS[t.seat]" stroke-width="0.1">
        <animate attributeName="r" values="0.42;0.62;0.42" dur="1s" repeatCount="indefinite" />
      </circle>
      <circle r="0.36" :fill="COLORS[t.seat]" stroke="#fff" stroke-width="0.09" />
      <circle r="0.13" cy="-0.08" fill="#fff" opacity="0.55" />
    </g>
  </svg>
</template>
