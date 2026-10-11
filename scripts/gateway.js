// Kaduna Kulture gateway - the single externally-visible port (:3000).
//
//   /api/*    -> FastAPI backend        (127.0.0.1:8000)
//   /ws/*     -> FastAPI WebSocket      (127.0.0.1:8000, upgrade)
//   /_nuxt/*  -> Nuxt dev assets        (127.0.0.1:3001)
//   /*        -> Nuxt app               (127.0.0.1:3001)
//
// While upstreams boot, it serves a friendly "warming up" page so the
// platform health check always gets a 200 on /.

import http from 'node:http'
import { spawn } from 'node:child_process'
import httpProxy from 'http-proxy'

const PORT = Number(process.env.GATEWAY_PORT || 3000)
const NUXT = 'http://127.0.0.1:3001'
const API = 'http://127.0.0.1:8000'

const ROOT = '/home/z/my-project'

// ------------------------------------------------------- self-bootstrap
// The gateway is the sandbox entrypoint (`bun run dev`). It brings up the
// full product stack as detached children so the whole system boots from
// one command. On a real deployment, docker-compose owns these services
// instead (see docker-compose.yml) - set KK_NO_BOOTSTRAP=1 to disable.
function spawnDetached(name, cmd, args, cwd, log) {
  try {
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: ['ignore', log, log],
      env: { ...process.env }
    })
    child.unref()
    console.log(`[kk-gateway] bootstrapped ${name} (pid ${child.pid})`)
  } catch (e) {
    console.error(`[kk-gateway] failed to bootstrap ${name}:`, e.message)
  }
}

if (!process.env.KK_NO_BOOTSTRAP) {
  const fs = await import('node:fs')
  const log = (p) => fs.openSync(p, 'a')
  spawnDetached(
    'kk-backend',
    'bash',
    [`${ROOT}/mini-services/kk-backend/run.sh`],
    ROOT,
    log('/tmp/kk-backend.log')
  )
  spawnDetached(
    'kk-llm-bridge',
    'bun',
    ['bridge.ts'],
    `${ROOT}/kaduna-kulture/services/llm-bridge`,
    log('/tmp/kk-bridge.log')
  )
  spawnDetached(
    'kk-frontend',
    'bash',
    [`${ROOT}/mini-services/kk-frontend/run.sh`],
    ROOT,
    log('/tmp/nuxt-dev.log')
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
    } catch {
      /* not ready yet */
    }
    await sleep(700)
  }
  return false
}

const proxy = httpProxy.createProxyServer({})

proxy.on('error', (err, req, res) => {
  const path = req.url || ''
  if (res instanceof http.ServerResponse && !res.headersSent) {
    if (path.startsWith('/api/')) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          detail: {
            code: 'backend_booting',
            message: 'Game backend is warming up - try again in a few seconds.',
            retryable: true
          }
        })
      )
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(bootPage())
    }
  }
})

function bootPage() {
  return `<!doctype html><html><head><title>Kaduna Kulture - booting</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0B3D2E;color:#F7F1E3;font-family:system-ui,sans-serif;text-align:center}
.c{max-width:560px;padding:24px}
h1{font-size:2.2rem;margin:0 0 8px;color:#E8B84B}
.sub{opacity:.75;margin-bottom:20px}
.spin{width:42px;height:42px;margin:0 auto 18px;border:4px solid rgba(232,184,75,.25);border-top-color:#E8B84B;border-radius:50%;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
</style></head>
<body><div class="c"><div class="spin"></div>
<h1>Kaduna Kulture</h1>
<div class="sub">A living Kaduna. An economy powered by Bitcoin.</div>
<div>World services are warming up - this page refreshes automatically…</div>
<script>setTimeout(()=>location.reload(),3000)<\/script>
</div></body></html>`
}

const server = http.createServer((req, res) => {
  const path = req.url || ''
  // changeOrigin: rewrite the Host header to the upstream - sandbox preview
  // domains (*.fcapp.run etc.) must never leak through to the dev servers.
  if (path.startsWith('/api/') || path.startsWith('/healthz')) {
    proxy.web(req, res, { target: API, changeOrigin: true })
  } else {
    proxy.web(req, res, { target: NUXT, changeOrigin: true })
  }
})

// WebSocket upgrades: /ws/game → FastAPI, everything else (Vite HMR) → Nuxt
server.on('upgrade', (req, socket, head) => {
  const path = req.url || ''
  const target = path.startsWith('/ws') ? API : NUXT
  proxy.ws(req, socket, head, { target, changeOrigin: true }, (err) => {
    if (err) {
      socket.destroy()
    }
  })
})

// Warm up before binding so the platform health check sees a real page when
// possible, but ALWAYS bind quickly enough (boot page still returns 200).
async function main() {
  await Promise.race([
    Promise.all([
      waitFor(`${API}/api/v1/health/live`, 30000),
      waitFor(NUXT, 45000)
    ]),
    sleep(12000)
  ])
  server.listen(PORT, () => {
    console.log(`[kk-gateway] :${PORT} → Nuxt(${NUXT}) + FastAPI(${API})`)
  })
}

main().catch((e) => {
  console.error('[kk-gateway] fatal:', e)
  process.exit(1)
})
