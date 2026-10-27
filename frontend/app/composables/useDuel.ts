// Arcade duels: two players play the same arcade game at the same time and
// see each other's score live; the higher final score wins. Messages ride
// the socket's arcade relay (the server only forwards small frames between
// the two phones): duel_invite -> duel_accept -> duel_go, then duel_score
// ticks and a duel_over with the final score each.
export interface Duel {
  peer: string
  peerName: string
  game: string
  host: boolean
  phase: 'invite' | 'playing' | 'done'
  me: { score: number; over: boolean }
  them: { score: number; over: boolean }
}

export const DUEL_GAMES = ['snake', 'runner', 'okada', 'blocks']

export function useDuel() {
  return useState<Duel | null>('kk_duel', () => null)
}

export function duelSend(to: string, data: Record<string, unknown>) {
  ;(window as any).__kk_ws_send?.('arcade.relay', { to, data })
}

/** handle a relayed duel frame (SocialNotices routes them here) */
export function onDuelFrame(from: string, x: any, accept: (fn: () => void, text: string) => void) {
  const duel = useDuel()
  const d = duel.value
  if (x.k === 'duel_invite') {
    accept(() => {
      duelSend(from, { k: 'duel_accept', name: usePlayerStore().profile?.display_name ?? 'Friend' })
      duel.value = { peer: from, peerName: x.name, game: x.game, host: false, phase: 'invite', me: { score: 0, over: false }, them: { score: 0, over: false } }
    }, `${x.name} wants an arcade duel: ${x.title}`)
    return
  }
  if (!d || d.peer !== from) return
  if (x.k === 'duel_accept' && d.host && d.phase === 'invite') {
    duelSend(from, { k: 'duel_go' })
    duel.value = { ...d, peerName: x.name || d.peerName, phase: 'playing' }
  } else if (x.k === 'duel_go' && !d.host) {
    duel.value = { ...d, phase: 'playing' }
  } else if (x.k === 'duel_score') {
    duel.value = { ...d, them: { ...d.them, score: Number(x.s) || 0 } }
  } else if (x.k === 'duel_over') {
    duel.value = { ...d, them: { score: Number(x.s) || 0, over: true }, phase: d.me.over ? 'done' : d.phase }
  } else if (x.k === 'duel_quit') {
    duel.value = { ...d, them: { ...d.them, over: true }, phase: 'done' }
  }
}
