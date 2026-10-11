// WS smoke: connect, resync, move, interact with Musa → expect npc.dialogue
// (DSH agent via LLM bridge or deterministic fallback).

const GATEWAY = process.env.KK_GATEWAY || 'http://localhost:3000'

async function main() {
  const reg = await fetch(`${GATEWAY}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `ws_${Date.now()}`,
      password: 'ws-smoke-test-123',
      display_name: 'WS Tester'
    })
  }).then((r) => r.json())
  const token = reg.access_token
  if (!token) throw new Error('register failed: ' + JSON.stringify(reg))

  const world = await fetch(`${GATEWAY}/api/v1/world/regions/ali-akilu-road`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((r) => r.json())
  const musa = world.entities.find((e) => e.code === 'npc_musa')

  const ws = new WebSocket(`ws://${GATEWAY.split('//')[1]}/ws/game?token=${token}`)
  const seen = []
  const expect = (type, timeoutMs = 90000) =>
    new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting ${type}`)), timeoutMs)
      const check = (m) => {
        if (m.type === type) {
          clearTimeout(t)
          res(m)
          return true // consumed
        }
        return false
      }
      handlers.push(check)
    })
  const handlers = []

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    console.log('  ← frame:', m.type)
    seen.push(m.type)
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i](m)) handlers.splice(i, 1)
    }
  }
  ws.onclose = (e) => console.log('!! ws CLOSE code=', e.code, 'reason=', e.reason)
  ws.onerror = (e) => console.error('!! ws error', e.message || e)

  await expect('player.state')
  console.log('✓ connected snapshot received')

  // Walk to Musa LEGALLY - the server enforces a 14 u/s speed envelope, so
  // hop ≤13.5 units per move with ≥1.05s gaps (dt cap → full allowance).
  const from = { x: 0, z: 42 } // spawn_roadside
  const to = { x: -16.5, z: -8.5 }
  const dist = Math.hypot(to.x - from.x, to.z - from.z)
  const hops = Math.ceil(dist / 13.5)
  const ux = (to.x - from.x) / dist
  const uz = (to.z - from.z) / dist
  console.log(`  walking ${dist.toFixed(1)} units in ${hops} hops (server speed envelope)…`)
  for (let k = 1; k <= hops; k++) {
    const d = Math.min(13.5 * k, dist)
    ws.send(
      JSON.stringify({
        type: 'player.move',
        payload: { position: [from.x + ux * d, 0, from.z + uz * d], facing: 0 }
      })
    )
    await new Promise((r) => setTimeout(r, 1100))
  }
  console.log('✓ walked to Musa within the speed envelope')

  ws.send(
    JSON.stringify({ type: 'entity.interact', payload: { entity_id: musa.id, message: 'Sannu boss! I wan buy suya spice with Lightning.' } })
  )
  const dlg = await expect('npc.dialogue')
  console.log('✓ npc.dialogue engine:', dlg.payload.engine)
  console.log('  Musa says:', JSON.stringify(dlg.payload.dialogue).slice(0, 220))

  ws.send(JSON.stringify({ type: 'state.resync', payload: {} }))
  await expect('player.state')
  console.log('✓ resync works. all messages seen:', [...new Set(seen)].join(', '))

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('WS SMOKE FAILED:', e.message)
  process.exit(1)
})
