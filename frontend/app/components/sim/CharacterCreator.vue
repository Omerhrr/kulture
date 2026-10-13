<script setup lang="ts">
// CharacterCreator - first-run "create your Sim" flow (Look -> Personality ->
// Dream -> Birth lottery). A live 3D preview spins on the left; choices sit
// in a card on the right (bottom sheet on phones). Saved to the sim store.
import { useSimStore, TRAITS, DREAMS, BIRTHS, type Look } from '~/stores/sim'

const sim = useSimStore()
const player = usePlayerStore()
const emit = defineEmits<{ (e: 'done'): void }>()

const STEPS = ['Look', 'Personality', 'Dream', 'Birth lottery'] as const
const step = ref(0)

const look = reactive<Look>({ ...sim.look })
const name = ref(sim.name || player.profile?.display_name || '')
const traits = ref<string[]>([...sim.traits])
const dream = ref(sim.dream)
const birth = ref<string | null>(null)
const rolling = ref(false)

const SKINS = ['#3a2216', '#4a2e1e', '#5e3a26', '#6e4630', '#7a4e33', '#8a5a3a', '#94603e', '#b07a52', '#c9946a']
const HAIR_COLORS = ['#141114', '#3a2414', '#6b3e1e', '#9a6a2a', '#9a9a9a', '#7a2a3a']
const TOPS = ['#2e7d5b', '#efe8d6', '#2f5fa8', '#b23a48', '#e0a020', '#5a3a7a', '#1d1c1f', '#e86a2c', '#1f2a44', '#d86a8a', '#3a7d8a', '#8a6a3a', '#f2f2f0', '#6a8a2a']
const BOTTOMS = ['#2b3440', '#efe8d6', '#1d1c1f', '#6b4a2f', '#2f5fa8', '#7a2a2a', '#5a5a5e', '#2e4a6e', '#c9b78e', '#3a3a2a']
const GADGETS = [
  { id: 'phone', label: '📱 Phone' },
  { id: 'sunglasses', label: '🕶️ Shades' },
  { id: 'cap', label: '🧢 Cap' },
  { id: 'headphones', label: '🎧 Headphones' },
  { id: 'watch', label: '⌚ Watch' },
  { id: 'backpack', label: '🎒 Backpack' },
  { id: 'bag', label: '👜 Bag' }
]
function toggleGadget(id: string) {
  const g = (look.gadgets ??= [])
  const i = g.indexOf(id)
  if (i >= 0) g.splice(i, 1)
  else g.push(id)
}
const HAIRS: Array<{ id: Look['hair']; label: string }> = [
  { id: 'cap', label: 'Kufi cap' },
  { id: 'afro', label: 'Afro' },
  { id: 'braids', label: 'Braids' },
  { id: 'bald', label: 'Low cut' }
]
const OUTFITS: Array<{ id: Look['outfit']; label: string }> = [
  { id: 'kaftan', label: 'Kaftan' },
  { id: 'shirt', label: 'Shirt & trousers' },
  { id: 'dress', label: 'Gown & hijab' }
]

function setBody(b: Look['body']) {
  look.body = b
  if (b === 'woman') {
    look.outfit = 'dress'
    look.hair = 'braids'
  } else {
    look.outfit = 'kaftan'
    look.hair = 'cap'
  }
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
function shuffle() {
  if (step.value === 0) {
    setBody(pick(['man', 'woman'] as const))
    look.skin = pick(SKINS)
    look.hairColor = pick(HAIR_COLORS)
    look.top = pick(TOPS)
    look.bottom = pick(BOTTOMS)
    if (look.body === 'man') look.hair = pick(['cap', 'afro', 'bald'] as const)
    look.outfit = look.body === 'woman' ? pick(['dress', 'shirt'] as const) : pick(['kaftan', 'shirt'] as const)
  } else if (step.value === 1) {
    const a = [...TRAITS].sort(() => Math.random() - 0.5)
    traits.value = [a[0].id, a[1].id]
  } else if (step.value === 2) {
    dream.value = pick(DREAMS).id
  }
}
function toggleTrait(id: string) {
  const i = traits.value.indexOf(id)
  if (i >= 0) traits.value.splice(i, 1)
  else if (traits.value.length < 2) traits.value.push(id)
  else traits.value = [traits.value[1], id]
}

const canNext = computed(() => {
  if (step.value === 0) return name.value.trim().length >= 2
  if (step.value === 1) return traits.value.length === 2
  if (step.value === 3) return !!birth.value
  return true
})
const cta = computed(() => {
  if (step.value === 1 && traits.value.length < 2) return `Choose ${2 - traits.value.length} more`
  if (step.value === 0 && !canNext.value) return 'Name your Sim'
  if (step.value === 3) return birth.value ? 'Move in and start living' : 'Rolling...'
  return 'Continue'
})
const birthInfo = computed(() => BIRTHS.find((b) => b.id === birth.value))

function rollBirth() {
  birth.value = null
  rolling.value = true
  setTimeout(() => {
    birth.value = pick(BIRTHS).id
    rolling.value = false
  }, 1100)
}
function next() {
  if (!canNext.value) return
  if (step.value < 3) {
    step.value++
    if (step.value === 3 && !birth.value) rollBirth()
    return
  }
  sim.look = { ...look }
  sim.name = name.value.trim().replace(/^@/, '')
  sim.traits = [...traits.value]
  sim.dream = dream.value
  sim.birth = birth.value!
  sim.created = true
  sim.save()
  emit('done')
}
function back() {
  if (step.value > 0) step.value--
}

// preview: drag to spin
const yaw = ref(0.35)
let drag: number | null = null
const previewKey = computed(() => JSON.stringify(look))
</script>

<template>
  <div class="absolute inset-0 z-[60] flex flex-col bg-gradient-to-b from-[#dfeaf5] to-[#f3efe6] lg:flex-row">
    <!-- top bar -->
    <div class="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 sm:p-4">
      <button class="kk-close h-11 w-11 bg-white shadow-md" :class="{ invisible: step === 0 }" aria-label="Back" @click="back">‹</button>
      <div class="text-center">
        <div class="font-display text-lg font-semibold text-ink">{{ STEPS[step] }}</div>
        <div class="mt-1 flex justify-center gap-1.5">
          <span v-for="(s, i) in STEPS" :key="s" class="h-1.5 w-7 rounded-full transition-colors" :class="i <= step ? 'bg-leaf' : 'bg-ink/15'" />
        </div>
      </div>
      <div class="flex gap-2">
        <button v-if="step < 3" class="kk-close h-11 w-11 bg-white text-lg shadow-md" title="Randomise" aria-label="Randomise" @click="shuffle">🔀</button>
        <button v-else class="kk-close h-11 w-11 bg-white text-lg shadow-md" title="Roll again" aria-label="Roll again" @click="rollBirth">🎲</button>
      </div>
    </div>

    <!-- 3D preview -->
    <div
      class="relative min-h-0 flex-1 touch-none select-none"
      @pointerdown="drag = $event.clientX"
      @pointermove="drag !== null && ((yaw += ($event.clientX - drag) * 0.012), (drag = $event.clientX))"
      @pointerup="drag = null"
      @pointerleave="drag = null"
    >
      <ClientOnly>
        <TresCanvas :clear-color="'#e6edf3'" :alpha="true" :dpr="[1, 1.5]">
          <TresPerspectiveCamera :position="[0, 1.15, 4.1]" :look-at="[0, 0.95, 0]" :fov="34" />
          <TresHemisphereLight :args="['#ffffff', '#c8b89a', 1.4]" />
          <TresDirectionalLight :position="[2, 4, 3]" :intensity="1.6" />
          <TresGroup :rotation="[0, yaw, 0]">
            <CharacterAvatar
              :key="previewKey"
              :shirt="look.top"
              :trouser="look.bottom"
              :skin="look.skin"
              :kufi="look.hair === 'cap'"
              :hijab="look.outfit === 'dress'"
              :hair-style="look.hair"
              :hair-color="look.hairColor"
              :outfit="look.outfit"
              :beard="look.body === 'man' && look.hair !== 'braids'"
              mode="idle"
            />
          </TresGroup>
          <TresMesh :rotation="[-Math.PI / 2, 0, 0]" :position="[0, 0, 0]">
            <TresCircleGeometry :args="[1.1, 48]" />
            <TresMeshBasicMaterial color="#d3d9df" />
          </TresMesh>
        </TresCanvas>
      </ClientOnly>
      <div class="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-ink/40">Drag to spin</div>
    </div>

    <!-- choices card -->
    <div class="relative flex max-h-[58dvh] w-full flex-col rounded-t-[2rem] bg-white shadow-2xl lg:m-4 lg:mt-20 lg:max-h-none lg:w-[440px] lg:rounded-[2rem]">
      <div class="kk-scroll min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        <!-- LOOK -->
        <template v-if="step === 0">
          <label class="flex items-center gap-2 rounded-2xl bg-paper px-4 py-3 focus-within:ring-2 focus-within:ring-leaf/40">
            <span class="font-display text-lg font-semibold text-ink/40">@</span>
            <input v-model="name" maxlength="18" class="w-full bg-transparent font-display text-lg font-semibold text-ink outline-none placeholder:text-ink/30" placeholder="yourname" />
            <span class="shrink-0 text-xs text-ink/40">your Sim's name</span>
          </label>
          <div class="kk-sec">Body</div>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="b in (['woman', 'man'] as const)" :key="b" class="kk-opt" :class="{ on: look.body === b }" @click="setBody(b)">{{ b === 'woman' ? 'Woman' : 'Man' }}</button>
          </div>
          <div class="kk-sec">Skin tone</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="c in SKINS" :key="c" class="kk-swatch" :class="{ on: look.skin === c }" :style="{ background: c }" :aria-label="'Skin ' + c" @click="look.skin = c" />
          </div>
          <div class="kk-sec">Hairstyle</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="h in HAIRS" :key="h.id" class="kk-opt" :class="{ on: look.hair === h.id }" @click="look.hair = h.id">{{ h.label }}</button>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-2">
            <button v-for="c in HAIR_COLORS" :key="c" class="kk-swatch !h-7 !w-7" :class="{ on: look.hairColor === c }" :style="{ background: c }" :aria-label="'Hair colour ' + c" @click="look.hairColor = c" />
          </div>
          <div class="kk-sec">Outfit</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="o in OUTFITS" :key="o.id" class="kk-opt" :class="{ on: look.outfit === o.id }" @click="look.outfit = o.id">{{ o.label }}</button>
          </div>
          <div class="kk-sec">Top colour</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="c in TOPS" :key="c" class="kk-swatch" :class="{ on: look.top === c }" :style="{ background: c }" :aria-label="'Top ' + c" @click="look.top = c" />
          </div>
          <div class="kk-sec">Trousers / wrapper</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="c in BOTTOMS" :key="c" class="kk-swatch" :class="{ on: look.bottom === c }" :style="{ background: c }" :aria-label="'Bottom ' + c" @click="look.bottom = c" />
          </div>
          <div class="kk-sec">Extras</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="g in GADGETS" :key="g.id" class="kk-opt" :class="{ on: (look.gadgets ?? []).includes(g.id) }" @click="toggleGadget(g.id)">{{ g.label }}</button>
          </div>
        </template>

        <!-- PERSONALITY -->
        <template v-else-if="step === 1">
          <p class="mb-3 text-sm text-ink/60">Choose 2 traits for {{ name || 'your Sim' }}.</p>
          <div class="grid grid-cols-2 gap-2.5">
            <button v-for="t in TRAITS" :key="t.id" class="kk-card-opt" :class="{ on: traits.includes(t.id) }" @click="toggleTrait(t.id)">
              <div class="text-2xl">{{ t.icon }}</div>
              <div class="mt-1.5 font-display text-[15px] font-semibold text-ink">{{ t.name }}</div>
              <div class="mt-0.5 text-xs leading-snug text-ink/55">{{ t.blurb }}</div>
            </button>
          </div>
        </template>

        <!-- DREAM -->
        <template v-else-if="step === 2">
          <p class="mb-3 text-sm text-ink/60">What's {{ name || 'your Sim' }}'s big dream?</p>
          <div class="space-y-2.5">
            <button v-for="d in DREAMS" :key="d.id" class="kk-card-opt flex w-full items-center gap-3.5 text-left" :class="{ on: dream === d.id }" @click="dream = d.id">
              <div class="text-3xl">{{ d.icon }}</div>
              <div>
                <div class="font-display text-[15px] font-semibold text-ink">{{ d.name }}</div>
                <div class="text-xs text-ink/55">{{ d.blurb }}</div>
              </div>
            </button>
          </div>
        </template>

        <!-- BIRTH LOTTERY -->
        <template v-else>
          <p class="text-center text-sm text-ink/60">Every child of Kaduna is born into something. What was {{ name || 'your Sim' }} born into?</p>
          <div class="mx-auto mt-4 flex h-32 w-32 items-center justify-center rounded-[2rem] bg-gradient-to-br from-kasand/40 to-kasand text-6xl shadow-lg shadow-kasand/30" :class="{ 'animate-bounce': rolling }">
            {{ rolling ? '🎲' : birthInfo?.icon }}
          </div>
          <template v-if="birthInfo && !rolling">
            <div class="mt-4 text-center font-display text-3xl font-semibold text-ink">{{ birthInfo.name }}</div>
            <div class="text-center text-sm font-semibold text-ink/55">{{ birthInfo.blurb }}</div>
            <div class="mt-4 space-y-2">
              <div class="flex items-center gap-2.5 rounded-2xl bg-paper px-4 py-3 text-sm text-ink/75">✨ {{ birthInfo.perk }}</div>
              <div class="flex items-center gap-2.5 rounded-2xl bg-paper px-4 py-3 text-sm text-ink/75">💰 {{ birthInfo.cash }}</div>
            </div>
          </template>
          <div v-else class="mt-4 text-center text-sm font-semibold text-ink/40">Rolling the dice...</div>
        </template>
      </div>
      <div class="border-t border-ink/5 p-4 sm:p-5">
        <button class="w-full rounded-full py-4 font-display text-lg font-semibold text-white shadow-lg transition-colors" :class="canNext ? 'bg-leaf shadow-leaf/30 hover:bg-kadeep' : 'cursor-not-allowed bg-leaf/35 shadow-none'" :disabled="!canNext" @click="next">
          {{ cta }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kk-sec {
  @apply mb-2 mt-5 text-sm font-semibold text-ink/55;
}
.kk-opt {
  @apply rounded-full bg-ink/5 px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-ink/10;
}
.kk-opt.on {
  @apply bg-ink text-white hover:bg-ink;
}
.kk-swatch {
  @apply h-9 w-9 rounded-full ring-2 ring-transparent ring-offset-2 transition;
}
.kk-swatch.on {
  @apply ring-leaf;
}
.kk-card-opt {
  @apply rounded-3xl border-2 border-transparent bg-ink/[0.04] p-4 text-left transition-colors hover:bg-ink/[0.07];
}
.kk-card-opt.on {
  @apply border-leaf bg-leaf/10;
}
</style>
