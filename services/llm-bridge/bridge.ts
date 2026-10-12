// DSH LLM bridge - OpenAI-compatible /v1/chat/completions endpoint backed by
// z-ai-web-dev-sdk (server-side only). The Python agent runtime speaks
// standard OpenAI chat protocol to this bridge; swap KK_LLM_BASE_URL to
// https://api.deepseek.com for production DeepSeek access.

import { spawn } from 'node:child_process'
import ZAI from 'z-ai-web-dev-sdk'

const PORT = Number(process.env.PORT || 8100)

// Bootstrap the game backend if it is not reachable. The bridge is a
// platform-owned long-lived process, so children it spawns survive (tool
// spawned processes do not). Idempotent: only fires when :8000 is down.
async function ensureBackend() {
  if (process.env.KK_NO_BOOTSTRAP) return
  try {
    const res = await fetch('http://127.0.0.1:8000/api/v1/health/live', {
      signal: AbortSignal.timeout(1500)
    })
    if (res.ok) return
  } catch {
    /* backend down - boot it */
  }
  const log = await import('node:fs')
  const out = log.openSync('/tmp/kk-backend.log', 'a')
  const child = spawn('bash', ['/home/z/my-project/mini-services/kk-backend/supervise.sh'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env }
  })
  child.unref()
  console.log(`[kk-bridge] bootstrapped kk-backend supervisor (pid ${child.pid})`)
}
ensureBackend().catch((e) => console.error('[kk-bridge] bootstrap failed:', e?.message || e))

interface ChatMessage {
  role: string
  content: string
}

let zai: any = null
async function getZAI() {
  if (!zai) zai = await ZAI.create()
  return zai
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, service: 'kk-llm-bridge', provider: 'z-ai-web-dev-sdk' })
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      try {
        const body = (await req.json()) as {
          messages?: ChatMessage[]
          temperature?: number
          max_tokens?: number
        }
        const messages = Array.isArray(body.messages) ? body.messages : []
        if (!messages.length) {
          return Response.json({ error: { message: 'messages required' } }, { status: 400 })
        }

        const z = await getZAI()
        // z-ai-web-dev-sdk expects the system prompt on an 'assistant' role
        // message; convert OpenAI-style messages accordingly.
        let system = ''
        const rest: ChatMessage[] = []
        for (const m of messages) {
          if (m.role === 'system') system = m.content
          else rest.push(m)
        }
        const sdkMessages: ChatMessage[] = []
        if (system) sdkMessages.push({ role: 'assistant', content: system })
        sdkMessages.push(...rest.slice(-8)) // bounded context

        const completion = await z.chat.completions.create({
          messages: sdkMessages,
          thinking: { type: 'disabled' }
        })
        const content = completion?.choices?.[0]?.message?.content ?? ''
        if (!content) {
          return Response.json({ error: { message: 'empty completion' } }, { status: 502 })
        }
        return Response.json({
          id: `kkbridge-${Date.now()}`,
          object: 'chat.completion',
          model: 'z-ai-bridge',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        })
      } catch (err: any) {
        console.error('[kk-llm-bridge] error:', err?.message || err)
        return Response.json(
          { error: { message: `bridge_error: ${err?.message || 'unknown'}` } },
          { status: 502 }
        )
      }
    }

    return Response.json({ error: { message: 'not found' } }, { status: 404 })
  }
})

console.log(`[kk-llm-bridge] listening on :${PORT} (OpenAI-compatible /v1/chat/completions)`)

// bridge touch: re-run bootstrap
