<script setup lang="ts">
// ArcadeCover - the painted cover art on each game's card in the phone
// arcade, drawn with the same art kit as the games themselves.
import { hidpi, fillTex, drawPerson, POSE, drawMango, drawCoin, drawCarTop, drawOkadaTop, drawTreeTop, drawKekeTop, groundShadow, shade, sparkle, type ArcadeLook } from '~/utils/arcadeArt'

const props = defineProps<{ game: string }>()
const cv = ref<HTMLCanvasElement | null>(null)
const W = 160
const H = 100

const A: ArcadeLook = { skin: '#6e4630', hair: '#141114', hairStyle: 'fade', top: '#2f5fa8', sleeves: 'short', bottom: '#3a4a6e', shoe: '#f2f0ea' }
const B: ArcadeLook = { skin: '#4a2e1f', hair: '#141114', hairStyle: 'bald', top: '#c0392b', sleeves: 'none', bottom: '#2b2b30', shoe: '#1d1c1f', beard: true }

function paint(g: CanvasRenderingContext2D, id: string) {
  const sky = (stops: string[]) => {
    const gr = g.createLinearGradient(0, 0, 0, H)
    stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c))
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)
  }
  if (id === 'snake') {
    fillTex(g, 'grass', 0, 0, W, H)
    const pts: Array<[number, number]> = []
    for (let i = 0; i < 26; i++) pts.push([20 + i * 4.4, 60 + Math.sin(i * 0.45) * 18])
    g.lineCap = 'round'
    g.lineJoin = 'round'
    const path = () => {
      g.beginPath()
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    }
    path()
    g.strokeStyle = '#123d17'
    g.lineWidth = 12
    g.stroke()
    g.strokeStyle = '#2f8a3a'
    g.lineWidth = 9.5
    g.stroke()
    g.strokeStyle = '#5cb85c'
    g.lineWidth = 4
    g.stroke()
    const [hx, hy] = pts[pts.length - 1]!
    g.fillStyle = '#2f8a3a'
    g.beginPath()
    g.ellipse(hx + 2, hy, 7.5, 6.2, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff8d0'
    g.beginPath()
    g.arc(hx + 4, hy - 3, 1.8, 0, Math.PI * 2)
    g.fill()
    drawMango(g, 140, 44, 9, 0, true)
  } else if (id === 'runner') {
    sky(['#5fb3e8', '#bfe0ef', '#f6d9a8'])
    for (let i = 0; i < 4; i++) {
      const x = i * 44 - 4
      g.fillStyle = ['#e6d5b8', '#c9d6c0', '#e3c4a8', '#cfd3dc'][i]!
      g.fillRect(x, 44, 38, 34)
      g.fillStyle = '#7f868c'
      g.beginPath()
      g.moveTo(x - 3, 46)
      g.lineTo(x + 19, 34)
      g.lineTo(x + 41, 46)
      g.fill()
    }
    fillTex(g, 'laterite', 0, 78, W, 22)
    g.fillStyle = '#5f9a3a'
    g.fillRect(0, 76, W, 4)
    groundShadow(g, 52, 78, 9, 2.5)
    drawPerson(g, 52, 78, 0.42, 1, A, POSE.run(1.1))
    drawCoin(g, 92, 50, 5, 0.3)
    drawCoin(g, 108, 46, 5, 0.6)
    drawCoin(g, 124, 50, 5, 0.9)
  } else if (id === 'brawl') {
    sky(['#1d1640', '#6b2f5e', '#e8774a', '#ffc078'])
    g.fillStyle = '#4a2a4f'
    for (let i = 0; i < 7; i++) g.fillRect(i * 24, 40 + (i % 3) * 8, 21, 60)
    g.fillStyle = '#ffcf6b'
    for (let i = 0; i < 7; i++) g.fillRect(i * 24 + 6, 50 + (i % 3) * 8, 4, 5)
    fillTex(g, 'asphalt', 0, 84, W, 16)
    groundShadow(g, 60, 86, 14, 3)
    groundShadow(g, 100, 86, 14, 3)
    drawPerson(g, 62, 86, 0.78, 1, A, POSE.punch(0.42))
    drawPerson(g, 102, 86, 0.78, -1, B, POSE.hurt())
    sparkle(g, 92, 40, 7)
    sparkle(g, 98, 32, 4)
  } else if (id === 'stick') {
    sky(['#070b1c', '#1b2347', '#3a2a4a'])
    for (let i = 0; i < 26; i++) (g.fillStyle = 'rgba(255,255,255,0.7)'), g.fillRect((i * 61) % W, (i * 37) % 60, 1, 1)
    g.fillStyle = '#f5f1d0'
    g.beginPath()
    g.arc(130, 20, 9, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#11152a'
    for (let i = 0; i < 8; i++) g.fillRect(i * 21, 50 + (i % 3) * 7, 19, 60)
    fillTex(g, 'concrete', 14, 80, 132, 7)
    g.fillStyle = '#2b2f3e'
    g.fillRect(18, 87, 124, 13)
    drawPerson(g, 60, 80, 0.5, 1, A, POSE.swing(0.35), { staff: 26 })
    drawPerson(g, 104, 80, 0.5, -1, { ...B, band: '#f5f1ea', hairStyle: 'fade', beard: false }, POSE.guard(0), { staff: 26 })
  } else if (id === 'okada') {
    fillTex(g, 'grass', 0, 0, W, H)
    fillTex(g, 'asphalt', 30, 0, 100, H)
    g.fillStyle = 'rgba(245,245,240,0.8)'
    for (let y = 0; y < H; y += 22) g.fillRect(63, y, 2, 11), g.fillRect(96, y, 2, 11)
    drawTreeTop(g, 12, 24, 11)
    drawTreeTop(g, 148, 70, 12, 1)
    drawCarTop(g, 47, 30, 22, 38, '#f5c400', { stripes: '#151515', rack: true })
    drawKekeTop(g, 113, 34)
    drawOkadaTop(g, 80, 74, 0, '#c0392b', '#f39c12', -0.15)
  } else {
    fillTex(g, 'sand', 0, 0, W, H)
    fillTex(g, 'laterite', 40, 6, 80, 90)
    g.fillStyle = 'rgba(30,18,10,0.5)'
    g.fillRect(40, 6, 80, 90)
    const cols = ['#b5523b', '#d9822b', '#d8b23a', '#5f9a4a', '#3d78b0', '#8a5aa8']
    const rows = ['111101111', '111111011', '011111111']
    rows.forEach((row, j) => [...row].forEach((v, i) => {
      if (v !== '1') return
      const c = cols[(i + j * 2) % cols.length]!
      const gr = g.createLinearGradient(0, 60 + j * 10, 0, 70 + j * 10)
      gr.addColorStop(0, shade(c, 0.2))
      gr.addColorStop(1, shade(c, -0.2))
      g.fillStyle = gr
      g.fillRect(41 + i * 8.8, 66 + j * 10, 8, 9)
    }))
    g.fillStyle = shade('#3d78b0', 0.1)
    for (const [i, j] of [[3, 0], [4, 0], [5, 0], [4, 1]]) g.fillRect(41 + i! * 8.8, 18 + j! * 10, 8, 9)
    g.fillStyle = '#9aa0a6'
    g.fillRect(37, 4, 3, 94)
    g.fillRect(120, 4, 3, 94)
  }
  // gloss
  const gl = g.createLinearGradient(0, 0, 0, H)
  gl.addColorStop(0, 'rgba(255,255,255,0.16)')
  gl.addColorStop(0.45, 'rgba(255,255,255,0)')
  gl.addColorStop(1, 'rgba(0,0,0,0.3)')
  g.fillStyle = gl
  g.fillRect(0, 0, W, H)
}

onMounted(() => paint(hidpi(cv.value!, W, H), props.game))
</script>

<template>
  <canvas ref="cv" class="block aspect-[160/100] w-full" />
</template>
