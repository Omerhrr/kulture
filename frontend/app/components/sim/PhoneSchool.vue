<script setup lang="ts">
// Phone → School: enrol at Kaduna Poly or KASU, attend lectures (3-question
// quizzes), sit the exam (8 questions, 60% to pass). Certificates unlock the
// professional careers in the Work app. All grading happens on the server.
import { fmtNgn } from '~/utils/format'

const api = useGameApi()
const ui = useUiStore()
const st = ref<any>(null)
const school = ref('kadpoly')
const course = ref('computer_science')
const session = ref<any>(null)
const answers = ref<Record<string, number>>({})
const result = ref<any>(null)
const busy = ref(false)

async function load() {
  st.value = await api.apiGet<any>('/life/status')
}
onMounted(() => load().catch((e) => ui.showToast(e.message, 'error')))

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = true
  try {
    return await fn()
  } catch (e: any) {
    ui.showToast(e.message || 'Something went wrong', 'error')
  } finally {
    busy.value = false
  }
}
async function enroll() {
  await run(() => api.apiPost('/life/enroll', { school: school.value, course: course.value }))
  await load()
  ui.showToast('Enrolled! Your first lecture is ready.', 'success')
}
async function start(kind: 'lecture' | 'exam') {
  result.value = null
  answers.value = {}
  session.value = (await run(() => api.apiPost<any>('/life/session', { kind }))) ?? null
}
async function submit() {
  const r = await run(() => api.apiPost<any>('/life/session/submit', { answers: answers.value }))
  if (!r) return
  result.value = r
  session.value = null
  await load()
  if (r.kind === 'exam' && r.passed) ui.showToast('🎓 Certified! New careers unlocked in Work.', 'success')
}
const e = computed(() => st.value?.enrollment)
const learning = computed(() => e.value && !e.value.certified)
</script>

<template>
  <div class="space-y-3 text-ink">
    <div v-if="!st" class="p-4 text-center text-sm text-ink/50">Loading…</div>

    <!-- quiz in progress -->
    <div v-else-if="session" class="space-y-3">
      <div class="rounded-2xl bg-violet-50 p-3 text-xs font-bold text-violet-700">
        {{ session.kind === 'exam' ? '📝 Final exam' : '📖 Lecture' }} · {{ session.course }}
      </div>
      <div v-for="(q, i) in session.questions" :key="q.id" class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="mb-2 text-[13px] font-semibold">{{ i + 1 }}. {{ q.q }}</div>
        <button
          v-for="(o, oi) in q.options"
          :key="oi"
          class="mb-1 block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold"
          :class="answers[q.id] === oi ? 'bg-violet-600 text-white' : 'bg-white'"
          @click="answers[q.id] = oi"
        >{{ o }}</button>
      </div>
      <button class="w-full rounded-full bg-violet-600 py-3 font-bold text-white disabled:opacity-40" :disabled="busy || Object.keys(answers).length < session.questions.length" @click="submit">Submit answers</button>
    </div>

    <template v-else>
      <div v-if="result" class="rounded-2xl p-3 text-sm font-semibold" :class="result.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'">
        {{ result.passed ? '✅ Passed' : '❌ Not this time' }} · {{ result.correct }}/{{ result.total }} correct
        <span v-if="result.score != null"> · {{ result.score }}%</span>
      </div>

      <div v-if="st.certificates.length" class="rounded-2xl bg-amber-50 p-3">
        <div class="mb-1 text-xs font-bold text-amber-700">Your certificates</div>
        <div v-for="c in st.certificates" :key="c.course" class="text-sm font-semibold">🎓 {{ c.name }}</div>
      </div>

      <div v-if="learning" class="rounded-2xl bg-ink/[0.04] p-3">
        <div class="font-display text-base font-semibold">{{ e.course_name }}</div>
        <div class="text-xs text-ink/55">{{ e.school_name }}</div>
        <div class="my-2 h-2 overflow-hidden rounded-full bg-ink/10">
          <div class="h-full bg-violet-500" :style="{ width: `${(100 * e.lectures_done) / e.lectures_needed}%` }" />
        </div>
        <div class="mb-2 text-xs text-ink/60">Lectures {{ e.lectures_done }}/{{ e.lectures_needed }}<span v-if="e.exam_score != null"> · last exam {{ e.exam_score }}%</span></div>
        <button v-if="e.lectures_done < e.lectures_needed" class="w-full rounded-full bg-violet-600 py-2.5 text-sm font-bold text-white" :disabled="busy" @click="start('lecture')">Attend lecture</button>
        <button v-else class="w-full rounded-full bg-amber-500 py-2.5 text-sm font-bold text-white" :disabled="busy" @click="start('exam')">Sit the exam</button>
      </div>

      <div v-else class="space-y-2 rounded-2xl bg-ink/[0.04] p-3">
        <div class="text-xs font-bold text-ink/60">Enrol</div>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="(s, id) in st.prices.schools" :key="id" class="rounded-xl p-2 text-left text-xs" :class="school === id ? 'bg-violet-600 text-white' : 'bg-white'" @click="school = String(id)">
            <div class="font-bold">{{ s.name }}</div>
            <div class="opacity-70">{{ fmtNgn(s.fee) }} · {{ s.lectures }} lectures</div>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="(n, id) in st.prices.courses" :key="id" class="rounded-xl p-2 text-left text-xs font-semibold" :class="course === id ? 'bg-ink text-white' : 'bg-white'" @click="course = String(id)">{{ n }}</button>
        </div>
        <button class="w-full rounded-full bg-violet-600 py-2.5 text-sm font-bold text-white" :disabled="busy" @click="enroll">Pay fees & enrol</button>
        <p class="text-[10px] text-ink/45">Computer Science → Developer · Banking → Banker · Medicine → Doctor · Business Admin → Manager & your own business.</p>
      </div>
    </template>
  </div>
</template>
