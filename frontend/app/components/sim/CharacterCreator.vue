<script setup lang="ts">
// CharacterCreator - first-run "create your Sim" flow (Look -> Personality ->
// Dream -> Birth lottery). A live 3D preview spins on the left; choices sit
// in a card on the right (bottom sheet on phones). Saved to the sim store.
import { useSimStore, TRAITS, DREAMS, BIRTHS, type Look } from '~/stores/sim'
import { TOPS, BOTTOMS, SHOES, LABELS } from '~/utils/outfits'
import { SKIN_TONES, CLOTH_COLORS, BOTTOM_COLORS, SHOE_COLORS, HAIR_COLORS, fromSimLook, randomLook } from '~/utils/people'

const sim = useSimStore()
const player = usePlayerStore()
const emit = defineEmits<{ (e: 'done'): void }>()
/** change the look of an existing Sim (just the Look step, then save) */
const props = defineProps<{ editOnly?: boolean }>()

const STEPS = props.editOnly ? (['Look'] as const) : (['Look', 'Personality', 'Dream', 'Birth lottery'] as const)
const step = ref(0)

const look = reactive<Look>({ ...sim.look, shape: { ...(sim.look.shape ?? {}) } })
const name = ref(sim.name || player.profile?.display_name || '')
const traits = ref<string[]>([...sim.traits])
const dream = ref(sim.dream)
const birth = ref<string | null>(null)
const rolling = ref(false)

const SKINS = SKIN_TONES
const HAIRS_FOR = computed(() => (look.body === 'woman' ? (['braids', 'cornrows', 'afro', 'puff', 'locs', 'lowcut', 'bald'] as const) : (['lowcut', 'fade', 'afro', 'cornrows', 'locs', 'braids', 'bald'] as const)))
// face + build sliders (0..1 morph weights)
const FACE: Array<{ id: string; label: string }> = [
  { id: 'noseWide', label: 'Nose width' },
  { id: 'noseFlare', label: 'Nostrils' },
  { id: 'lipsFull', label: 'Lips' },
  { id: 'jawWide', label: 'Jaw' },
  { id: 'chinStrong', label: 'Chin' },
  { id: 'cheekbones', label: 'Cheekbones' },
  { id: 'eyesBig', label: 'Eyes' }
]
const HEADS = [
  { id: 'headRound', label: 'Round' },
  { id: 'headOval', label: 'Oval' },
  { id: 'headSquare', label: 'Square' }
]
const BUILDS = [
  { id: 'average', label: 'Average' },
  { id: 'slim', label: 'Slim' },
  { id: 'heavy', label: 'Heavy' },
  { id: 'muscular', label: 'Muscular' }
]
const build = computed(() => (['slim', 'heavy', 'muscular'] as const).find((b) => (look.shape[b] ?? 0) > 0) ?? 'average')
function setBuild(id: string) {
  for (const b of ['slim', 'heavy', 'muscular']) delete look.shape[b]
  if (id !== 'average') look.shape[id] = 0.6
}
const head = computed(() => HEADS.find((h) => (look.shape[h.id] ?? 0) > 0)?.id ?? null)
function setHead(id: string) {
  for (const h of HEADS) delete look.shape[h.id]
  if (head.value !== id) look.shape[id] = 0.5
}
const faceVal = (id: string) => look.shape[id] ?? 0
function setFace(id: string, v: number) {
  if (v > 0.001) look.shape[id] = v
  else delete look.shape[id]
}
// the preview camera: full figure, or close on the face while shaping it
const camView = ref<'body' | 'face'>('body')

function setBody(b: Look['body']) {
  look.body = b
  if (b === 'woman') {
    look.hair = 'braids'
    look.beard = 'none'
    look.topStyle = 'tee'
    look.bottomStyle = 'skirt'
  } else {
    look.hair = 'lowcut'
    look.topStyle = 'polo'
    look.bottomStyle = 'jeans'
  }
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
function shuffle() {
  if (step.value === 0) {
    // a whole new person: face, build and clothes
    const r = randomLook(Math.floor(Math.random() * 1e6), Math.random() < 0.5)
    look.body = r.female ? 'woman' : 'man'
    look.skin = r.skin
    look.shape = { ...r.shape }
    look.hair = r.outfit.hair
    look.hairColor = r.outfit.hairColor
    look.beard = r.outfit.beard ?? 'none'
    look.topStyle = r.outfit.top
    look.top = r.outfit.topColor
    look.bottomStyle = r.outfit.bottom
    look.bottom = r.outfit.bottomColor
    look.shoes = r.outfit.shoes
    look.shoeColor = r.outfit.shoeColor
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
  if (props.editOnly) return 'Save my look'
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
  if (props.editOnly) {
    sim.look = { ...look, shape: { ...look.shape } }
    sim.name = name.value.trim().replace(/^@/, '')
    sim.save()
    emit('done')
    return
  }
  if (step.value < 3) {
    step.value++
    if (step.value === 3 && !birth.value) rollBirth()
    return
  }
  sim.look = { ...look, shape: { ...look.shape } }
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
      <button v-if="props.editOnly" class="kk-close h-11 w-11 bg-white shadow-md" aria-label="Cancel" @click="emit('done')">✕</button>
      <button v-else class="kk-close h-11 w-11 bg-white shadow-md" :class="{ invisible: step === 0 }" aria-label="Back" @click="back">‹</button>
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
          <TresPerspectiveCamera v-if="camView === 'body'" :position="[0, 1.1, 4.3]" :look-at="[0, 0.9, 0]" :fov="32" />
          <TresPerspectiveCamera v-else :position="[0, look.body === 'woman' ? 1.56 : 1.66, 1.05]" :look-at="[0, look.body === 'woman' ? 1.54 : 1.64, 0]" :fov="24" />
          <TresHemisphereLight :args="['#ffffff', '#c8b89a', 1.4]" />
          <TresDirectionalLight :position="[2, 4, 3]" :intensity="1.6" />
          <TresGroup :rotation="[0, yaw, 0]">
            <CharacterAvatar :key="previewKey" :person="fromSimLook(look)" mode="idle" />
          </TresGroup>
          <TresMesh :rotation="[-Math.PI / 2, 0, 0]" :position="[0, 0, 0]">
            <TresCircleGeometry :args="[1.1, 48]" />
            <TresMeshBasicMaterial color="#d3d9df" />
          </TresMesh>
        </TresCanvas>
      </ClientOnly>
      <div class="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-ink/40">Drag to spin</div>
      <div v-if="step === 0" class="absolute right-3 top-20 flex rounded-full bg-white/90 p-1 shadow-md">
        <button v-for="v in (['body', 'face'] as const)" :key="v" class="rounded-full px-3 py-1.5 text-xs font-bold" :class="camView === v ? 'bg-ink text-white' : 'text-ink/60'" @click="camView = v">{{ v === 'body' ? 'Full body' : 'Face' }}</button>
      </div>
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
          <div class="kk-sec">Build</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="o in BUILDS" :key="o.id" class="kk-opt" :class="{ on: build === o.id }" @click="setBuild(o.id)">{{ o.label }}</button>
          </div>
          <div class="kk-sec flex items-center justify-between">Face <button class="text-xs font-bold text-leaf" @click="camView = 'face'">Look closer</button></div>
          <div class="flex flex-wrap gap-2">
            <button v-for="o in HEADS" :key="o.id" class="kk-opt" :class="{ on: head === o.id }" @click="setHead(o.id)">{{ o.label }} head</button>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
            <label v-for="f in FACE" :key="f.id" class="text-xs font-semibold text-ink/60">
              {{ f.label }}
              <input type="range" min="0" max="1" step="0.05" class="kk-range" :value="faceVal(f.id)" @input="setFace(f.id, +($event.target as HTMLInputElement).value), (camView = 'face')" />
            </label>
          </div>
          <div class="kk-sec">Hair</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="h in HAIRS_FOR" :key="h" class="kk-opt" :class="{ on: look.hair === h }" @click="look.hair = h">{{ LABELS[h] }}</button>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-2">
            <button v-for="c in HAIR_COLORS" :key="c" class="kk-swatch !h-7 !w-7" :class="{ on: look.hairColor === c }" :style="{ background: c }" :aria-label="'Hair colour ' + c" @click="look.hairColor = c" />
          </div>
          <template v-if="look.body === 'man'">
            <div class="kk-sec">Facial hair</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="b in (['none', 'stubble', 'full'] as const)" :key="b" class="kk-opt" :class="{ on: look.beard === b }" @click="look.beard = b">{{ LABELS[b] }}</button>
            </div>
          </template>
          <div class="kk-sec">Top</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="t in TOPS" :key="t" class="kk-opt" :class="{ on: look.topStyle === t }" @click="(look.topStyle = t), (camView = 'body')">{{ LABELS[t] }}</button>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-2">
            <button v-for="c in CLOTH_COLORS" :key="c" class="kk-swatch" :class="{ on: look.top === c }" :style="{ background: c }" :aria-label="'Top ' + c" @click="look.top = c" />
          </div>
          <div class="kk-sec">Bottoms</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="t in BOTTOMS" :key="t" class="kk-opt" :class="{ on: look.bottomStyle === t }" @click="(look.bottomStyle = t), (camView = 'body')">{{ LABELS[t] }}</button>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-2">
            <button v-for="c in BOTTOM_COLORS" :key="c" class="kk-swatch" :class="{ on: look.bottom === c }" :style="{ background: c }" :aria-label="'Bottoms ' + c" @click="look.bottom = c" />
          </div>
          <div class="kk-sec">Shoes</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="t in SHOES" :key="t" class="kk-opt" :class="{ on: look.shoes === t }" @click="(look.shoes = t), (camView = 'body')">{{ LABELS[t] }}</button>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-2">
            <button v-for="c in SHOE_COLORS" :key="c" class="kk-swatch" :class="{ on: look.shoeColor === c }" :style="{ background: c }" :aria-label="'Shoes ' + c" @click="look.shoeColor = c" />
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
.kk-range {
  @apply mt-1 w-full accent-leaf;
}
.kk-card-opt {
  @apply rounded-3xl border-2 border-transparent bg-ink/[0.04] p-4 text-left transition-colors hover:bg-ink/[0.07];
}
.kk-card-opt.on {
  @apply border-leaf bg-leaf/10;
}
</style>
