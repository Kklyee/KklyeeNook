import { afterEach, expect, test, vi } from 'vitest'
import { createPiHttpClient, type PiClientEvent, type PiThreadSnapshot } from '@assistant-ui/react-pi'

import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import { startAgentHttpServer, type RunningAgentHttpServer } from './httpServer'

const snapshot = {
  metadata: {
    id: 'thread-1',
    title: 'Test thread',
    status: 'idle',
    archived: false,
    workspacePath: 'C:/workspace',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  },
  messages: [],
} as PiThreadSnapshot

let server: RunningAgentHttpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

function makeClient(getSnapshot: () => PiThreadSnapshot = () => snapshot) {
  const subscriptions: Array<{
    options: { includeSnapshot?: boolean } | undefined
    emit: (event: PiClientEvent) => void
    unsubscribe: ReturnType<typeof vi.fn>
  }> = []
  const client: ContextAwarePiClient = {
    listThreads: vi.fn(async () => [snapshot.metadata]),
    createThread: vi.fn(async () => snapshot),
    getThread: vi.fn(async () => snapshot),
    sendMessage: vi.fn(async () => undefined),
    cancelRun: vi.fn(async () => undefined),
    clearQueue: vi.fn(async () => ({ steering: ['one'], followUp: ['two'] })),
    getAvailableModels: vi.fn(async () => []),
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    respondToHostUiRequest: vi.fn(async () => undefined),
    subscribe: vi.fn((threadId, listener, options) => {
      const unsubscribe = vi.fn()
      subscriptions.push({ options, emit: listener, unsubscribe })
      if (options?.includeSnapshot !== false) {
        listener({ type: 'snapshot', threadId, seq: 1, snapshot: getSnapshot() } as PiClientEvent)
      }
      listener({ type: 'agent_start', threadId, seq: 2 } as PiClientEvent)
      return unsubscribe
    }),
  }

  return { client, subscriptions }
}

test('serves the installed Pi HTTP contract through a random loopback endpoint', async () => {
  const { client } = makeClient()
  server = await startAgentHttpServer(client, {
    secret: 'a'.repeat(64),
    allowedOrigins: ['app://desktop'],
  })
  const endpoint = new URL(server.baseUrl)
  expect(endpoint.hostname).toBe('127.0.0.1')
  expect(Number(endpoint.port)).toBeGreaterThan(0)

  const piClient = createPiHttpClient({ baseUrl: server.baseUrl, streamCloseDelayMs: 0 })
  expect(await piClient.listThreads({ workspacePath: 'C:/workspace', includeArchived: true })).toEqual([
    snapshot.metadata,
  ])
  expect(await piClient.createThread({ title: 'New thread' })).toEqual(snapshot)
  expect(await piClient.getThread('thread-1')).toEqual(snapshot)
  await piClient.sendMessage('thread-1', { content: 'hello' })
  await piClient.cancelRun('thread-1')
  expect(await piClient.clearQueue('thread-1')).toEqual({ steering: ['one'], followUp: ['two'] })
  expect(await piClient.getAvailableModels({ workspacePath: 'C:/workspace' })).toEqual([])
  await piClient.setModel('thread-1', { provider: 'test', modelId: 'model' })
  await piClient.setThinkingLevel('thread-1', 'high')
  await piClient.renameThread('thread-1', 'Renamed')
  await piClient.archiveThread('thread-1')
  await piClient.unarchiveThread('thread-1')
  await piClient.deleteThread('thread-1')
  await piClient.respondToHostUiRequest('thread-1', { requestId: 'approval-1', value: 'Allow' })

  expect(client.listThreads).toHaveBeenCalledWith({
    workspacePath: 'C:/workspace',
    includeArchived: true,
  })
  expect(client.sendMessage).toHaveBeenCalledWith('thread-1', { content: 'hello' }, undefined)
  expect(client.setModel).toHaveBeenCalledWith('thread-1', { provider: 'test', modelId: 'model' })
  expect(client.respondToHostUiRequest).toHaveBeenCalledOnce()

  const attachmentResponse = await fetch(`${server.baseUrl}/threads/thread-1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { content: 'with file' }, contextAttachmentIds: ['attachment-1'] }),
  })
  expect(attachmentResponse.status).toBe(204)
  expect(client.sendMessage).toHaveBeenLastCalledWith(
    'thread-1',
    { content: 'with file' },
    ['attachment-1'],
  )
})

test('health and invalid paths disclose no secret; CORS only allows the configured renderer origin', async () => {
  const { client } = makeClient()
  server = await startAgentHttpServer(client, {
    secret: 'b'.repeat(64),
    allowedOrigins: ['app://desktop'],
  })

  const health = await fetch(new URL('/health', server.baseUrl))
  expect(await health.json()).toEqual({ ok: true, service: 'kklyeenook-agent-backend' })

  const wrongSecret = await fetch(new URL('/wrong/api/pi/threads', server.baseUrl))
  expect(wrongSecret.status).toBe(404)
  expect(await wrongSecret.text()).not.toContain('b'.repeat(64))

  const deniedOrigin = await fetch(`${server.baseUrl}/threads`, {
    headers: { origin: 'https://untrusted.example' },
  })
  expect(deniedOrigin.status).toBe(403)
  expect(deniedOrigin.headers.get('access-control-allow-origin')).toBeNull()

  const preflight = await fetch(`${server.baseUrl}/threads/thread-1/messages`, {
    method: 'OPTIONS',
    headers: {
      origin: 'app://desktop',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-allow-origin')).toBe('app://desktop')
})

test('SSE honors snapshot=false; disconnect unsubscribes but does not cancel the run', async () => {
  let authoritativeSnapshot = snapshot
  const { client, subscriptions } = makeClient(() => authoritativeSnapshot)
  server = await startAgentHttpServer(client, { secret: 'c'.repeat(64) })

  const firstController = new AbortController()
  const liveResponse = await fetch(
    `${server.baseUrl}/threads/thread-1/events?snapshot=false`,
    { signal: firstController.signal },
  )
  expect(liveResponse.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
  expect(subscriptions[0]?.options).toEqual({ includeSnapshot: false })
  const liveReader = liveResponse.body!.getReader()
  const liveChunk = await liveReader.read()
  expect(new TextDecoder().decode(liveChunk.value)).toContain('"type":"agent_start"')

  subscriptions[0]?.emit({ type: 'agent_end', threadId: 'thread-1', seq: 3 })
  const nextLiveChunk = await liveReader.read()
  expect(new TextDecoder().decode(nextLiveChunk.value)).toContain('"seq":3')

  firstController.abort()
  await vi.waitFor(() => expect(subscriptions[0]?.unsubscribe).toHaveBeenCalledOnce())
  expect(client.cancelRun).not.toHaveBeenCalled()

  authoritativeSnapshot = {
    ...snapshot,
    metadata: { ...snapshot.metadata, title: 'Latest authoritative title' },
  }
  const reconnectController = new AbortController()
  const reconnectResponse = await fetch(`${server.baseUrl}/threads/thread-1/events`, {
    signal: reconnectController.signal,
  })
  expect(subscriptions[1]?.options).toEqual({ includeSnapshot: true })
  const reconnectChunk = await reconnectResponse.body!.getReader().read()
  const reconnectData = new TextDecoder().decode(reconnectChunk.value)
  expect(reconnectData).toContain('"type":"snapshot"')
  expect(reconnectData).toContain('"title":"Latest authoritative title"')
  reconnectController.abort()
  await vi.waitFor(() => expect(subscriptions[1]?.unsubscribe).toHaveBeenCalledOnce())
  expect(client.sendMessage).not.toHaveBeenCalled()
})
