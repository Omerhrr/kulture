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
    status.value = 'connecting'
    ws = new WebSocket(`${proto}://${location.host}${wsPath}?token=${encodeURIComponent(token)}`)

    ws.onopen = () => {
      retry = 0
      status.value = 'open'
      ws?.send(JSON.stringify({ type: 'world.subscribe', payload: {} }))
      heartbeat = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'ping', payload: {} }))
      }, 25000)
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as ServerEvent
        handlers.forEach((h) => h(data))
      } catch {
        /* ignore malformed frames - server is trusted to send JSON */
      }
    }

    ws.onclose = () => {
      status.value = 'closed'
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      ws = null
      if (!closedByUs) {
        retry += 1
        const delay = Math.min(8000, 600 * 2 ** Math.min(retry, 4))
        setTimeout(() => connect(), delay)
      }
    }

    ws.onerror = () => ws?.close()
  }

  function disconnect() {
    closedByUs = true
    ws?.close()
    ws = null
    if (heartbeat) clearInterval(heartbeat)
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
