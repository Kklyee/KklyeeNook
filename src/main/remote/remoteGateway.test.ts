import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteGatewayApp, startRemoteGateway } from './remoteGateway'
import { RemoteError, type RemoteAgentPort } from './remoteAgentPort'
import type { RemoteConversationSnapshot, RemoteEvent } from '@kklyeenook/shared/remote/index'

const origin = 'https://desktop.example.ts.net'
const headers = { 'tailscale-user-login': 'kk@example.com', origin, 'content-type': 'application/json' }
const snapshot: RemoteConversationSnapshot = { id: 'chat', projectId: 'project', title: 'Chat', status: 'running', updatedAt: 1, permission: 'workspace-write', thinkingLevel: 'off', messages: [], activities: [], queue: [], approvals: [] }
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

function fixture() {
  let listener: ((event: RemoteEvent) => void) | undefined
  const unsubscribe = vi.fn()
  const port: RemoteAgentPort = {
    getState: vi.fn(async () => ({ models: [], permissions: ['read-only' as const], defaults: { permission: 'read-only' as const, provider: 'test', modelId: 'test', thinkingLevel: 'off' } })),
    listProjects: vi.fn(async () => [{ id: 'project', name: 'App', conversationCount: 1, activeRunCount: 1 }]),
    getProject: vi.fn(async () => ({ id: 'project', name: 'App', conversationCount: 1, activeRunCount: 1 })),
    listConversations: vi.fn(async () => [snapshot]),
    getConversation: vi.fn(async () => snapshot),
    createConversation: vi.fn(async () => snapshot),
    renameConversation: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    setPermission: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setThinkingLevel: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    clearQueue: vi.fn(async () => {}),
    updateQueue: vi.fn(async () => {}),
    respondToApproval: vi.fn(async () => {}),
    listModels: vi.fn(async () => []),
    subscribe: vi.fn((_id, callback) => { listener = callback; callback({ type: 'snapshot', snapshot, seq: 1 }); return unsubscribe }),
  }
  const options = { staticRoot: 'apps/remote/dist', identity: () => ({ origin, allowedLogin: 'kk@example.com' }) }
  return { port, options, app: createRemoteGatewayApp(port, options), unsubscribe, emit: (event: RemoteEvent) => listener?.(event) }
}

test('requires Tailscale identity on assets and APIs, enforces allowed user and blocks cross-site mutation', async () => {
  const { app, port } = fixture()
  expect((await app.request('/api/projects')).status).toBe(401)
  expect((await app.request('/')).status).toBe(401)
  expect((await app.request('/api/projects', { headers: { ...headers, 'tailscale-user-login': 'other@example.com' } })).status).toBe(403)
  expect((await app.request('/api/projects', { headers: { ...headers, origin: 'https://attacker.test' } })).status).toBe(403)
  expect((await app.request('/api/conversations/chat/cancel', { method: 'POST', headers: { 'tailscale-user-login': 'kk@example.com' } })).status).toBe(403)
  expect((await app.request('/api/projects', { headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  expect(port.cancel).not.toHaveBeenCalled()
  expect((await app.request('/api/projects', { headers })).status).toBe(200)
})

test('whitelists operations, validates payloads and never exposes arbitrary shell, files or settings', async () => {
  const { app, port } = fixture()
  for (const path of ['/api/shell', '/api/settings', '/api/files', '/api/credentials', '/api/pi/threads']) expect((await app.request(path, { headers })).status).toBe(404)
  const send = (body: unknown) => app.request('/api/conversations/chat/messages', { method: 'POST', headers, body: JSON.stringify(body) })
  expect((await send({ content: '', mode: 'normal' })).status).toBe(400)
  expect((await send({ content: 'hi', mode: 'exec' })).status).toBe(400)
  expect((await send({ content: 'hi', mode: 'steer', shell: 'ignored' })).status).toBe(200)
  expect(port.sendMessage).toHaveBeenCalledWith('chat', { content: 'hi', mode: 'steer' })
  expect((await send({ content: 'x'.repeat(70000), mode: 'normal' })).status).toBe(413)
  expect((await app.request('/api/conversations/chat/permission', { method: 'POST', headers, body: JSON.stringify({ permission: 'root' }) })).status).toBe(400)
})

test('passes project, conversation, configuration, queue and approval requests to the existing port', async () => {
  const { app, port } = fixture()
  const input = { permission: 'workspace-write', provider: 'test', modelId: 'model', thinkingLevel: 'low', prompt: 'Implement this' }
  expect((await app.request('/api/projects/project/conversations', { method: 'POST', headers, body: JSON.stringify(input) })).status).toBe(201)
  expect(port.createConversation).toHaveBeenCalledWith('project', input)
  for (const [route, body] of [
    ['model', { provider: 'test', modelId: 'model' }],
    ['thinking', { thinkingLevel: 'low' }],
    ['queue/item', { mode: 'followUp', expected: ['a', 'b'], index: 0, action: 'move', value: 1 }],
  ] as const) expect((await app.request('/api/conversations/chat/' + route, { method: 'POST', headers, body: JSON.stringify(body) })).status).toBe(200)
  expect(port.updateQueue).toHaveBeenCalledWith('chat', { mode: 'followUp', expected: ['a', 'b'], index: 0, action: 'move', value: 1 })
  expect((await app.request('/api/approvals/approval/respond', { method: 'POST', headers, body: JSON.stringify({ conversationId: 'chat', confirmed: false }) })).status).toBe(200)
  expect(port.respondToApproval).toHaveBeenCalledWith('approval', { conversationId: 'chat', confirmed: false })
})

test('preserves conflict status and sanitizes unexpected backend errors', async () => {
  const { app, port } = fixture()
  vi.mocked(port.sendMessage).mockRejectedValueOnce(new RemoteError(409, 'Run is active'))
  expect((await app.request('/api/conversations/chat/messages', { method: 'POST', headers, body: JSON.stringify({ mode: 'normal', content: 'hi' }) })).status).toBe(409)
  vi.mocked(port.getConversation).mockRejectedValueOnce(new Error('secret path C:\\private\\keys.json'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = await app.request('/api/conversations/chat', { headers })
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Request failed' })
  log.mockRestore()
})

test('serves only the PWA directory and binds only loopback', async () => {
  const { port, options } = fixture()
  const directory = await mkdtemp(join(tmpdir(), 'nook-remote-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'index.html'), '<h1>PWA</h1>')
  await writeFile(join(directory, 'secret.json'), 'secret')
  const gateway = await startRemoteGateway(port, { ...options, staticRoot: directory, port: 0 })
  cleanup.unshift(() => gateway.close())
  const base = `http://127.0.0.1:${gateway.port}`
  expect(await (await fetch(base + '/', { headers })).text()).toBe('<h1>PWA</h1>')
  expect((await fetch(base + '/secret.json', { headers })).status).toBe(404)
  expect((await fetch(base + '/assets/%2e%2e%2fsecret.json', { headers })).status).toBe(404)
  expect((await fetch(base + '/api/projects', { headers })).headers.get('cache-control')).toBe('no-store')
})

test('SSE snapshots on every reconnect, streams updates and disconnects without cancelling Agent', async () => {
  const { port, options, unsubscribe, emit } = fixture()
  const gateway = await startRemoteGateway(port, { ...options, port: 0 })
  cleanup.unshift(() => gateway.close())
  const url = `http://127.0.0.1:${gateway.port}/api/conversations/chat/events`
  for (let attempt = 0; attempt < 2; attempt++) {
    const abort = new AbortController()
    const response = await fetch(url, { headers, signal: abort.signal })
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"snapshot"')
    emit({ type: 'status', status: 'running', seq: 2 })
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"status"')
    abort.abort()
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(attempt + 1))
  }
  expect(port.cancel).not.toHaveBeenCalled()
})
