import { afterEach, expect, test } from 'vitest'
import { HttpError, readJsonBody, startAuthenticatedServer, type RunningAgentHttpServer } from './http-server'

let server: RunningAgentHttpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function start() {
  server = await startAuthenticatedServer(async (context, prefix) => {
    if (!context.req.path.startsWith(prefix + '/')) throw new HttpError(404, 'not_found', 'Route not found.')
    if (context.req.path.endsWith('/body')) return context.json(await readJsonBody(context))
    if (context.req.path.endsWith('/missing')) throw new Error('Conversation not found: private-id')
    if (context.req.path.endsWith('/busy')) throw new Error('Conversation busy: private-id')
    if (context.req.path.endsWith('/failure')) throw new Error('private-key')
    return context.json({ ok: true })
  }, { secret: 'b'.repeat(64), allowedOrigins: ['app://desktop'] })
  return server.baseUrl
}

test('uses an authenticated random loopback endpoint and restricts renderer origins', async () => {
  const base = await start()
  const endpoint = new URL(base)
  expect(endpoint.hostname).toBe('127.0.0.1')
  expect(Number(endpoint.port)).toBeGreaterThan(0)
  expect(endpoint.pathname).toBe('/' + 'b'.repeat(64) + '/api/agent')
  const health = await fetch(new URL('/health', base))
  expect(await health.json()).toEqual({ ok: true, service: 'kklyeenook-agent-backend' })
  const wrong = await fetch(new URL('/wrong/api/agent/threads', base))
  expect(wrong.status).toBe(404)
  expect(await wrong.text()).not.toContain('b'.repeat(64))
  const denied = await fetch(base + '/threads', { headers: { origin: 'https://untrusted.example' } })
  expect(denied.status).toBe(403)
  expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  const preflight = await fetch(base + '/body', { method: 'OPTIONS', headers: { origin: 'app://desktop', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type', 'access-control-request-private-network': 'true' } })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-allow-origin')).toBe('app://desktop')
  expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
  const allowed = await fetch(base + '/threads', { headers: { origin: 'app://desktop' } })
  expect(allowed.status).toBe(200)
  expect(allowed.headers.get('vary')).toBe('Origin')
})

test('rejects invalid JSON and oversized bodies before the operation', async () => {
  const base = await start()
  const post = (body: string) => fetch(base + '/body', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  expect((await post('{')).status).toBe(400)
  expect((await post(JSON.stringify('x'.repeat(4 * 1024 * 1024)))).status).toBe(413)
  expect(await (await post('')).json()).toEqual({})
  expect(await (await post(JSON.stringify({ input: 'hello' }))).json()).toEqual({ input: 'hello' })
})

test('maps failures to public statuses without leaking execution data and closes connections', async () => {
  const base = await start()
  for (const [route, status] of [['missing', 404], ['busy', 409], ['failure', 500]] as const) {
    const response = await fetch(base + '/' + route)
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('private-')
  }
  await server!.close()
  await server!.close()
  await expect(fetch(base + '/threads')).rejects.toThrow()
})
