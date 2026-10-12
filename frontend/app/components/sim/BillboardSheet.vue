<script setup lang="ts">
// BillboardSheet - what's on air on a billboard, links out to advertisers,
// and "Add your ad to this board": design an ad (live preview), pick days,
// pay with Lightning. The ad airs after the payment is verified (and, if
// moderation is on, after review).
import { useAdsStore } from '~/stores/ads'
import { billboardById } from '~/utils/billboards'
import { drawAd, AD_THEMES, houseAds } from '~/utils/adArt'

const ads = useAdsStore()
const payments = usePaymentsStore()
const ui = useUiStore()
const board = computed(() => (ads.sheetBoard ? billboardById(ads.sheetBoard) : null))
const num = computed(() => (board.value ? Number(board.value.id.slice(3)) + 1 : 0))
const live = computed(() => (board.value ? ads.boards[board.value.id] ?? [] : []))
const mode = ref<'view' | 'edit' | 'sent'>('view')

// previews are canvas renders turned into images
const preview = (ad: any) => drawAd(document.createElement('canvas'), ad).toDataURL('image/png')
const liveImgs = computed(() => (void ads.version, live.value.map((a) => ({ a, img: preview(a) }))))
const houseImg = computed(() => preview(houseAds(ads.price)[0]))

const form = reactive({ brand: '', headline: '', subline: '', cta: 'Learn more', url: '', theme: 'green', days: 1 })
const draftImg = ref('')
watch(
  () => ({ ...form }),
  (f) => {
    const domain = (f.url || '').replace(/^https?:\/\//, '').split('/')[0]
    draftImg.value = preview({ brand: f.brand || 'Your brand', headline: f.headline || 'Your headline here', subline: f.subline, cta: f.cta, domain, theme: f.theme })
  },
  { immediate: true, deep: true }
)
const price = computed(() => ads.price * form.days)
const valid = computed(() => form.brand.trim().length >= 2 && form.headline.trim().length >= 3)
const busy = ref(false)
const err = ref('')

async function pay() {
  if (!valid.value || !board.value) return
  busy.value = true
  err.value = ''
  try {
    await ads.buy({ ...form, board_id: board.value.id })
    mode.value = 'sent'
  } catch (e: any) {
    err.value = e.message || 'Could not create the invoice'
  } finally {
    busy.value = false
  }
}
// after the Lightning dialog settles, refresh so a live ad shows up
watch(
  () => payments.current?.status,
  (s) => {
    if (s === 'settled' && ads.pendingAdId) {
      setTimeout(() => ads.refresh().catch(() => {}), 800)
      ads.loadMine().catch(() => {})
    }
  }
)
const myStatus = computed(() => ads.mine.find((a) => a.id === ads.pendingAdId)?.status)

function visit(url: string, domain: string) {
  if (!url) return
  if (confirm(`Leave the game and open ${domain}?`)) window.open(url, '_blank', 'noopener,noreferrer')
}
function close() {
  ads.sheetBoard = null
  mode.value = 'view'
}
const until = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
watch(
  () => ads.sheetBoard,
  () => {
    mode.value = 'view'
    err.value = ''
  }
)
void ui
</script>

<template>
  <transition enter-active-class="transition duration-300 ease-out" enter-from-class="translate-y-8 opacity-0">
    <div v-if="board" class="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/30 backdrop-blur-[3px] sm:items-center" @click.self="close">
      <div class="flex max-h-[92dvh] w-[min(820px,100vw)] flex-col rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
        <div class="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-ink/10" />
        <div class="flex items-center gap-3 px-6 pb-2 pt-4">
          <span class="flex h-14 w-14 items-center justify-center rounded-full bg-paper text-2xl">📢</span>
          <div class="min-w-0 flex-1">
            <div class="font-display text-2xl font-semibold text-ink">Billboard {{ num }}</div>
            <div class="truncate text-sm text-ink/55">{{ board.road }} · {{ board.area }} · digital</div>
          </div>
          <button class="kk-close" aria-label="Close" @click="close">✕</button>
        </div>

        <div class="kk-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          <!-- ON AIR -->
          <template v-if="mode === 'view'">
            <div class="mb-3 mt-1 flex items-center gap-2 text-sm text-ink/60">
              <span class="rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-extrabold text-white">● ON AIR</span>
              <span v-if="live.length">{{ live.length }} ad{{ live.length > 1 ? 's' : '' }} take turns, 15 s each</span>
              <span v-else>Free right now. Be the first on this board.</span>
            </div>
            <div class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
              <div v-for="{ a, img } in liveImgs" :key="a.id" class="w-[min(560px,80vw)] shrink-0 snap-start">
                <img :src="img" :alt="`${a.brand}: ${a.headline}`" class="w-full rounded-2xl border-4 border-ink shadow-md" />
                <div class="mt-2 flex items-center gap-3">
                  <button v-if="a.url" class="flex-1 rounded-full bg-leaf py-2.5 text-sm font-bold text-white hover:bg-kadeep" @click="visit(a.url, a.domain)">↗ Visit {{ a.domain }}</button>
                  <span class="text-xs text-ink/45">until {{ until(a.ends_at) }}</span>
                </div>
              </div>
              <div v-if="!live.length" class="w-[min(560px,80vw)] shrink-0">
                <img :src="houseImg" alt="Your ad here" class="w-full rounded-2xl border-4 border-ink shadow-md" />
              </div>
            </div>
            <button class="mt-3 w-full rounded-full border-2 border-ink/10 py-3.5 font-display text-lg font-semibold text-ink hover:border-ink/25" @click="mode = 'edit'">
              ＋ Add your ad to this board
            </button>
            <p class="mt-2 text-center text-xs text-ink/45">{{ ads.price.toLocaleString() }} sats per day · paid with Lightning · real links to your business</p>
          </template>

          <!-- EDITOR -->
          <template v-else-if="mode === 'edit'">
            <img :src="draftImg" alt="Ad preview" class="mt-1 w-full rounded-2xl border-4 border-ink shadow-md" />
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <label class="kk-field">Brand<input v-model="form.brand" maxlength="32" class="kk-input" placeholder="Mama Put Kitchen" /></label>
              <label class="kk-field">Website (optional)<input v-model="form.url" maxlength="200" class="kk-input" placeholder="mamaput.ng" inputmode="url" /></label>
              <label class="kk-field sm:col-span-2">Headline<input v-model="form.headline" maxlength="60" class="kk-input" placeholder="Hot tuwo, cold zobo" /></label>
              <label class="kk-field">Tagline<input v-model="form.subline" maxlength="90" class="kk-input" placeholder="Barnawa, behind the market" /></label>
              <label class="kk-field">Button text<input v-model="form.cta" maxlength="24" class="kk-input" placeholder="Order now" /></label>
            </div>
            <div class="mt-4 text-sm font-semibold text-ink/55">Colours</div>
            <div class="mt-2 flex flex-wrap gap-2">
              <button v-for="(t, k) in AD_THEMES" :key="k" class="flex items-center gap-2 rounded-full border-2 py-1 pl-1 pr-3 text-sm font-bold" :class="form.theme === k ? 'border-leaf' : 'border-transparent bg-ink/5'" @click="form.theme = k as string">
                <span class="h-6 w-6 rounded-full" :style="{ background: `linear-gradient(135deg, ${t.bg}, ${t.bg2})` }" />{{ t.label }}
              </button>
            </div>
            <div class="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-paper p-3">
              <div class="text-sm font-semibold text-ink/70">Days on air</div>
              <div class="flex items-center gap-2">
                <button class="kk-close bg-white" :disabled="form.days <= 1" @click="form.days--">−</button>
                <span class="w-8 text-center font-display text-lg font-semibold">{{ form.days }}</span>
                <button class="kk-close bg-white" :disabled="form.days >= ads.maxDays" @click="form.days++">＋</button>
              </div>
            </div>
            <p class="mt-3 text-xs leading-relaxed text-ink/50">
              Your ad shares this board with up to 3 others (15 s each).
              {{ ads.autoApprove ? 'It goes on air as soon as the Lightning payment is verified.' : 'After payment it is reviewed, then goes on air for the days you bought.' }}
              Links must be a normal https website.
            </p>
            <p v-if="err" class="mt-2 rounded-2xl bg-red-50 p-2.5 text-sm font-semibold text-red-600" role="alert">{{ err }}</p>
          </template>

          <!-- SENT -->
          <template v-else>
            <div class="py-6 text-center">
              <div class="text-5xl">{{ myStatus === 'live' ? '📢' : myStatus === 'pending_review' ? '🕵🏾' : '⚡' }}</div>
              <div class="mt-3 font-display text-2xl font-semibold text-ink">
                {{ myStatus === 'live' ? "You're on air!" : myStatus === 'pending_review' ? 'Paid. In review.' : 'Waiting for your Lightning payment' }}
              </div>
              <p class="mx-auto mt-2 max-w-sm text-sm text-ink/60">
                {{ myStatus === 'live' ? 'Every player who passes this board sees your ad now.' : myStatus === 'pending_review' ? 'A moderator checks every ad before it airs. Your days start counting when it goes live.' : 'Pay the invoice in the Lightning window. The ad activates once the node confirms it.' }}
              </p>
              <button class="mt-5 rounded-full bg-ink/5 px-6 py-3 font-bold text-ink" @click="mode = 'view'">Back to the board</button>
            </div>
          </template>
        </div>

        <div v-if="mode === 'edit'" class="flex gap-3 border-t border-ink/5 p-4">
          <button class="rounded-full px-5 py-3.5 font-bold text-ink/60 hover:bg-ink/5" @click="mode = 'view'">Back</button>
          <button class="flex-1 rounded-full py-3.5 font-display text-lg font-semibold text-white shadow-lg transition-colors" :class="valid && !busy ? 'bg-leaf shadow-leaf/30 hover:bg-kadeep' : 'bg-leaf/35'" :disabled="!valid || busy" @click="pay">
            {{ busy ? 'Creating invoice...' : `Pay ⚡ ${price.toLocaleString()} sats` }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.kk-field {
  @apply flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-ink/45;
}
.kk-field .kk-input {
  @apply text-base font-semibold normal-case tracking-normal;
}
</style>
