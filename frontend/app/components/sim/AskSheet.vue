<script setup lang="ts">
// AskSheet - "Ask Kaduna Kulture": quick answers about the game. Answers
// come from a local FAQ (works offline on venue Wi-Fi); free text is
// matched by keywords.
const open = useState<boolean>('kk_ask_open', () => false)
interface QA { q: string; a: string; k: string[] }
const FAQ: QA[] = [
  { q: 'Where do I start?', k: ['start', 'begin', 'first', 'new'], a: "Walk to Musa's Provision Store across the street (the guide card shows the way). Talk to Musa, take a delivery job, and pay for something with Lightning." },
  { q: 'How do I get a job?', k: ['job', 'work', 'earn', 'money'], a: 'Open Phone → Jobs, or tap + next to your money. Accept a delivery, pick up the package at Musa\'s and drop it with Hajiya Amina at Stonetech Square.' },
  { q: 'How do I pay with Lightning?', k: ['lightning', 'sats', 'bitcoin', 'pay', 'buy', 'invoice'], a: 'Tap Buy, pick an item and scan the QR with any Lightning wallet (Phoenix, Zeus, BlueWallet). The server verifies the payment with the Lightning node before the item lands in your bag.' },
  { q: 'How do I keep my Sim happy?', k: ['happy', 'mood', 'need', 'hungry', 'tired', 'sleep', 'eat'], a: 'Keep the six needs green. At home: fridge or cooker for hunger, bed for energy, TV for fun, toilet and shower. Talking to people fills social.' },
  { q: 'How do I go home?', k: ['home', 'house', 'apartment', 'inside'], a: 'Tap Home on the dock. You can also walk up to any compound gate in the city and press E to look inside.' },
  { q: 'How do I drive?', k: ['drive', 'car', 'keke', 'okada', 'bus', 'ride', 'vehicle'], a: 'Walk up to a parked keke, car, okada or bus and press E (or tap BOARD). Use WASD to drive, V for the inside view, E again to get out.' },
  { q: 'Is the naira real money?', k: ['naira', 'ngn', 'real', 'withdraw'], a: 'No. Naira (₦) is game money you earn from jobs. Only Lightning sats are real Bitcoin, and the two are never converted.' }
]
const thread = ref<Array<{ from: 'me' | 'bot'; text: string }>>([{ from: 'bot', text: 'Sannu! ✨ Ask me anything about Kaduna Kulture.' }])
const input = ref('')
function ask(text: string) {
  const t = text.trim()
  if (!t) return
  thread.value.push({ from: 'me', text: t })
  const low = t.toLowerCase()
  let best: QA | null = FAQ.find((f) => f.q.toLowerCase() === low) ?? null
  if (!best) {
    let score = 0
    for (const f of FAQ) {
      const s = f.k.filter((k) => low.includes(k)).length
      if (s > score) (score = s), (best = f)
    }
  }
  thread.value.push({ from: 'bot', text: best ? best.a : "I'm not sure about that one yet. Try: jobs, Lightning, needs, driving, or going home." })
  input.value = ''
}
</script>

<template>
  <transition enter-active-class="transition duration-300 ease-out" enter-from-class="translate-y-8 opacity-0">
    <div v-if="open" class="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/30 sm:items-center" @click.self="open = false">
      <div class="flex h-[min(600px,88dvh)] w-[min(560px,100vw)] flex-col rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
        <div class="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-ink/10" />
        <div class="flex items-center gap-3 px-6 pb-3 pt-4">
          <span class="flex h-12 w-12 items-center justify-center rounded-full bg-paper text-2xl">✨</span>
          <div class="flex-1">
            <div class="font-display text-xl font-semibold text-ink">Ask Kaduna Kulture</div>
            <div class="text-sm text-ink/55">Quick answers about the game</div>
          </div>
          <button class="kk-close" aria-label="Close" @click="open = false">✕</button>
        </div>
        <div class="kk-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 pb-3">
          <div v-for="(m, i) in thread" :key="i" class="flex" :class="m.from === 'me' ? 'justify-end' : ''">
            <div class="max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed" :class="m.from === 'me' ? 'bg-leaf text-white' : 'bg-paper text-ink'">{{ m.text }}</div>
          </div>
          <div class="flex flex-wrap gap-2 pt-1">
            <button v-for="f in FAQ" :key="f.q" class="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:border-ink/30" @click="ask(f.q)">{{ f.q }}</button>
          </div>
        </div>
        <form class="flex gap-2 p-4" @submit.prevent="ask(input)">
          <input v-model="input" class="kk-input !rounded-full" placeholder="Ask a question..." />
          <button class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-leaf text-xl text-white disabled:opacity-40" :disabled="!input.trim()" aria-label="Send">↑</button>
        </form>
      </div>
    </div>
  </transition>
</template>
