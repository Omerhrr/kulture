// Native WebSocket client with reconnect + authoritative state resync.
// Server messages are the ONLY source of truth for balance/inventory/job changes.

import type { ServerEvent } from '~/types'

type Handler = (event: ServerEvent) => void

export function useGameSocket() {
  const config = useRuntimeConfig()
  const wsPath = config.public.wsPath as string

  let ws: WebSocket | null = null
  let closedByUs = false
  let retry = 0
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const handlers = new Set<Handler>()

  const status = useState<'connecting' | 'open' | 'closed'>('kk_ws_status', () => 'closed')

  function connect() {
    const token = localStorage.getItem('kk_token')
    if (!token || ws) return
    closedByUs = false
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base =
      (config.public.wsBase as string) ||
      (import.meta.dev ? `${proto}://${location.hostname}:8000` : `${proto}://${location.host}`)
    status.value = 'connecting'
    // every handler below is bound to THIS socket: a stale socket closing
    // late (e.g. disconnect() then connect() on login) must not clobber the
    // new connection or schedule a duplicate reconnect.
    const sock = new WebSocket(`${base}${wsPath}?token=${encodeURIComponent(token)}`)
    ws = sock

    sock.onopen = () => {
      if (ws !== sock) return sock.close()
      retry = 0
      status.value = 'open'
      sock.send(JSON.stringify({ type: 'world.subscribe', payload: {} }))
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN)
          sock.send(JSON.stringify({ type: 'ping', payload: {} }))
      }, 25000)
    }

    sock.onmessage = (ev) => {
      if (ws !== sock) return
      try {
        const data = JSON.parse(ev.data) as ServerEvent
        handlers.forEach((h) => h(data))
        // phone apps (games, DMs, likes) listen on a window event
        const t = (data as any).type as string
        if (t && (t.startsWith('game.') || t.startsWith('social.') || t.startsWith('race.') || t.startsWith('arcade.') || t.startsWith('wallet.') || t.startsWith('store.') || t.startsWith('home.'))) window.dispatchEvent(new CustomEvent('kk-ws', { detail: data }))
      } catch {
        /* ignore malformed frames - server is trusted to send JSON */
      }
    }

    sock.onclose = (ev) => {
      if (ws !== sock) return // superseded or deliberately replaced
      status.value = 'closed'
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      ws = null
      if (ev.code === 4401) {
        // server rejected the token: retrying with it can never succeed
        window.dispatchEvent(new Event('kk-auth-expired'))
        return
      }
      if (!closedByUs) {
        retry += 1
        const delay = Math.min(8000, 600 * 2 ** Math.min(retry, 4))
        setTimeout(() => connect(), delay)
      }
    }

    sock.onerror = () => sock.close()
  }

  function disconnect() {
    closedByUs = true
    const old = ws
    ws = null // detach first so the old socket's late events are ignored
    old?.close()
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    status.value = 'closed'
  }

  function send(type: string, payload: Record<string, unknown>) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }))
      return true
    }
    return false
  }

  /** Throttled movement sender (client-side rate shaping; server re-checks). */
  const move = (() => {
    let last = 0
    let latest: { position: [number, number, number]; facing: number } | null = null
    return {
      push(position: [number, number, number], facing: number) {
        latest = { position, facing }
        const now = Date.now()
        if (now - last >= 110) {
          last = now
          send('player.move', latest)
        }
      }
    }
  })()

  function resync() {
    send('state.resync', {})
  }

  function onMessage(handler: Handler) {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  onUnmounted(() => disconnect())

  return { connect, disconnect, send, move, resync, onMessage, status }
}
