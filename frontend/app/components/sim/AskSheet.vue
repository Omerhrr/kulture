<script setup lang="ts">
import { useSimStore, NEEDS } from '~/stores/sim'
// AskSheet - "Ask Kaduna Kulture": quick answers about the game. Answers
// come from a local FAQ (works offline on venue Wi-Fi); free text is
// matched by keywords.
const open = useState<boolean>('kk_ask_open', () => false)
interface QA { q: string; a: string; k: string[] }
const FAQ: QA[] = [
  { q: 'Where do I start?', k: ['start', 'begin', 'first', 'new'], a: "Follow the story card (top left): your aunty sent you with a letter for Mallam Musa, whose Provision Store is just across the street. Walk up to him and press E." },
  { q: 'What is the story?', k: ['story', 'chapter', 'quest', 'mission', 'next', 'act'], a: "Two acts, fifteen chapters. Act 1, Musa's Promise: from Musa's store to Stonetech Square, over the river to Mama Chidi, KASU, Kawo Motor Park, Rigasa Station and Sabon Tasha, then your own shop. Act 2, Kaduna Rising: stock your shelves, win the Professor's trivia wager, fetch Bashir's spare parts, work a shift for Amina's nephew, carry aso-ebi for Ngozi's sister's wedding, the Big Order for Tunde's train, and Mallam Musa's blessing. The story card shows who to see; at a pickup or drop-off, tap its button." },
  { q: 'How do I get a job?', k: ['job', 'work', 'earn', 'money'], a: 'The story chapters pay for every delivery. For more: Phone → Work for shifts at a workplace, or the job board (J) for open deliveries around town.' },
  { q: 'How do I pay with Lightning?', k: ['lightning', 'sats', 'bitcoin', 'pay', 'buy', 'invoice'], a: 'Tap Buy, pick an item and scan the QR with any Lightning wallet (Phoenix, Zeus, BlueWallet). The server verifies the payment with the Lightning node before the item lands in your bag.' },
  { q: 'How do I keep my Sim happy?', k: ['happy', 'mood', 'need', 'hungry', 'tired', 'sleep', 'eat'], a: 'Keep the six needs green. At home: fridge or cooker for hunger, bed for energy, TV for fun, toilet and shower. Talking to people fills social.' },
  { q: 'How do I go home?', k: ['home', 'house', 'apartment', 'inside'], a: 'Tap Home on the dock. You can also walk up to any compound gate in the city and press E to look inside.' },
  { q: 'How do I drive?', k: ['drive', 'car', 'keke', 'okada', 'bus', 'ride', 'vehicle'], a: 'Walk up to a parked keke, car, okada or bus and press E (or tap BOARD). Use WASD to drive, V for the inside view, E again to get out.' },
  { q: 'Are k-sats real money?', k: ['ksats', 'k-sats', 'naira', 'ngn', 'real', 'withdraw'], a: 'No. k-sats are game money you earn from jobs or by depositing Lightning sats (1 sat = 1,000 k-sats). Only sats are real Bitcoin, and k-sats are never paid back out.' }
]
const thread = ref<Array<{ from: 'me' | 'bot'; text: string; ai?: boolean }>>([{ from: 'bot', text: 'Sannu! ✨ Ask me anything about Kaduna Kulture.' }])
const input = ref('')
const sim = useSimStore()
const thinking = ref(false)
function offline(t: string): string {
  const low = t.toLowerCase()
  let best: QA | null = FAQ.find((f) => f.q.toLowerCase() === low) ?? null
  if (!best) {
    let score = 0
    for (const f of FAQ) {
      const s = f.k.filter((k) => low.includes(k)).length
      if (s > score) (score = s), (best = f)
    }
  }
  return best ? best.a : "I'm not sure about that one yet. Try: work, jobs, Lightning, needs, driving, or going home."
}
async function ask(text: string) {
  const t = text.trim()
  if (!t || thinking.value) return
  const history = thread.value.slice(1).map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }))
  thread.value.push({ from: 'me', text: t })
  input.value = ''
  thinking.value = true
  try {
    const low = NEEDS.filter((n) => sim.needs[n.key] < 35).map((n) => n.label)
    const r = await useGameApi().ask(t, history, { mood: sim.mood.label, low_needs: low })
    thread.value.push({ from: 'bot', text: r.answer ?? offline(t), ai: !!r.answer })
  } catch (e: any) {
    thread.value.push({ from: 'bot', text: e?.status === 429 ? e.message : offline(t) })
  } finally {
    thinking.value = false
  }
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
            <div class="text-sm text-ink/55">AI guide · knows the game and your Sim</div>
          </div>
          <button class="kk-close" aria-label="Close" @click="open = false">✕</button>
        </div>
        <div class="kk-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 pb-3">
          <div v-for="(m, i) in thread" :key="i" class="flex" :class="m.from === 'me' ? 'justify-end' : ''">
            <div class="max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed" :class="m.from === 'me' ? 'bg-leaf text-white' : 'bg-paper text-ink'">
              {{ m.text }}
              <div v-if="m.ai" class="mt-1 text-[10px] font-bold uppercase tracking-wider text-ink/35">✨ AI answer</div>
            </div>
          </div>
          <div v-if="thinking" class="flex"><div class="rounded-3xl bg-paper px-4 py-2.5 text-[15px] text-ink/50">Thinking<span class="animate-pulse">...</span></div></div>
          <div class="flex flex-wrap gap-2 pt-1">
            <button v-for="f in FAQ" :key="f.q" class="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:border-ink/30" @click="ask(f.q)">{{ f.q }}</button>
          </div>
        </div>
        <form class="flex gap-2 p-4" @submit.prevent="ask(input)">
          <input v-model="input" class="kk-input !rounded-full" placeholder="Ask a question..." />
          <button class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-leaf text-xl text-white disabled:opacity-40" :disabled="!input.trim() || thinking" aria-label="Send">↑</button>
        </form>
      </div>
    </div>
  </transition>
</template>
