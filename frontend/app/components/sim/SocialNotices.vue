<script setup lang="ts">
// SocialNotices - pop-ups for things friends send you while you play:
// game invites (Whot/Ludo/Ayo head-to-head), Street Brawl fight challenges
// (live, relayed over the socket), gifts and crew chat.
import { fmtKsats } from '~/utils/format'
import { onDuelFrame } from '~/composables/useDuel'

const ui = useUiStore()
const player = usePlayerStore()
const phoneOpen = useState<boolean>('kk_phone_open', () => false)
const goto = useState<string | null>('kk_phone_goto', () => null)
const pending = useState<any>('kk_game_pending', () => null)
const fight = useState<{ peer: string; peerName: string; host: boolean; ready: boolean } | null>('kk_fight', () => null)

interface Notice { id: number; icon: string; text: string; accept?: () => void; label?: string; ttl: number }
const notices = ref<Notice[]>([])
let nid = 0
function push(n: Omit<Notice, 'id' | 'ttl'>, secs = 20) {
  const id = ++nid
  notices.value.push({ ...n, id, ttl: secs })
  setTimeout(() => dismiss(id), secs * 1000)
}
function dismiss(id: number) {
  notices.value = notices.value.filter((n) => n.id !== id)
}
const relay = (to: string, data: unknown) => (window as any).__kk_ws_send?.('arcade.relay', { to, data })
const myName = () => player.profile?.display_name ?? 'Friend'

function onWs(ev: Event) {
  const d = (ev as CustomEvent).detail
  const p = d?.payload ?? {}
  if (d?.type === 'game.invite') {
    push({
      icon: '🎮',
      text: `${p.name} challenges you to ${p.game_name}${p.stake ? ` (stake ${fmtKsats(p.stake)})` : ''}`,
      accept: () => {
        pending.value = { accept: p.id, game: p.game }
        goto.value = 'games'
        phoneOpen.value = true
      }
    }, 170)
  } else if (d?.type === 'social.gift') {
    ui.showToast(`🎁 ${p.name} sent you ${p.amount ? fmtKsats(p.amount) : p.item ?? 'a gift'}`, 'success')
    ;(window as any).__kk_ws_send?.('state.resync', {}) // refresh balance + bag
  } else if (d?.type === 'wallet.received') {
    push({ icon: '⚡', text: `${p.from?.name ?? 'Someone'} sent you ${fmtKsats(p.amount)}${p.note ? ` - "${p.note}"` : ''}`, label: 'View', accept: () => ((goto.value = 'wallet'), (phoneOpen.value = true)) }, 12)
    ;(window as any).__kk_ws_send?.('state.resync', {})
  } else if (d?.type === 'store.sale') {
    ui.showToast(`🛒 ${p.buyer} bought ${p.name} x${p.qty} at your store · +${fmtKsats(p.got)}`, 'success')
    ;(window as any).__kk_ws_send?.('state.resync', {})
  } else if (d?.type === 'social.crew') {
    if (!(phoneOpen.value && (window as any).__kk_phone_page === 'crews')) ui.showToast(`👥 ${p.name}: ${String(p.text).slice(0, 60)}`, 'info')
  } else if (d?.type === 'arcade.fight') {
    const x = p.data ?? {}
    if (String(x.k).startsWith('duel_')) {
      onDuelFrame(p.from, x, (fn, text) =>
        push({ icon: '⚔️', text, accept: () => ((goto.value = 'arcade'), (phoneOpen.value = true), fn()) }, 45)
      )
    } else if (x.k === 'ride_invite') {
      push({
        icon: '🚗',
        text: `${x.name} offers you a ride in ${x.own ? 'their own car' : `a ${x.label}`}`,
        accept: () => window.dispatchEvent(new CustomEvent('kk-ride-accept', { detail: { from: p.from, name: x.name } }))
      }, 40)
    } else if (x.k === 'invite') {
      push({
        icon: '🥊',
        text: `${x.name} wants a live Street Brawl!`,
        accept: () => {
          relay(p.from, { k: 'accept', name: myName() })
          fight.value = { peer: p.from, peerName: x.name, host: false, ready: true }
          goto.value = 'arcade'
          phoneOpen.value = true
        }
      }, 60)
    } else if (x.k === 'accept' && fight.value && !fight.value.ready && fight.value.peer === p.from) {
      fight.value = { ...fight.value, peerName: x.name || fight.value.peerName, ready: true }
      goto.value = 'arcade'
      phoneOpen.value = true
    }
  }
}
function onFightInvite(ev: Event) {
  const { to, name } = (ev as CustomEvent).detail
  fight.value = { peer: to, peerName: name, host: true, ready: false }
  relay(to, { k: 'invite', name: myName() })
  ui.showToast(`🥊 Challenge sent - waiting for ${name}…`, 'info')
  setTimeout(() => {
    if (fight.value && !fight.value.ready && fight.value.peer === to) {
      fight.value = null
      ui.showToast(`${name} didn't answer the fight.`, 'info')
    }
  }, 60000)
}
onMounted(() => {
  window.addEventListener('kk-ws', onWs)
  window.addEventListener('kk-fight-invite', onFightInvite)
})
onBeforeUnmount(() => {
  window.removeEventListener('kk-ws', onWs)
  window.removeEventListener('kk-fight-invite', onFightInvite)
})
</script>

<template>
  <div class="pointer-events-none absolute right-3 top-24 z-[45] flex w-[min(300px,80vw)] flex-col gap-2">
    <div v-for="n in notices" :key="n.id" class="pointer-events-auto kk-panel flex items-center gap-2 px-3 py-2 text-xs font-semibold text-ink">
      <span class="text-xl">{{ n.icon }}</span>
      <span class="flex-1">{{ n.text }}</span>
      <button v-if="n.accept" class="kk-chip bg-emerald-600 text-white" @click="n.accept(), dismiss(n.id)">{{ n.label ?? 'Accept' }}</button>
      <button class="opacity-50" @click="dismiss(n.id)">✕</button>
    </div>
  </div>
</template>
