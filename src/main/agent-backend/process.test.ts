import { EventEmitter } from 'node:events'
import { afterEach, expect, test, vi } from 'vitest'

import type { AgentBackendInitOptions, MainToAgentBackendMessage } from './protocol'
import { AgentBackendProcess, type UtilityProcessLike } from './process'

const options: AgentBackendInitOptions = {
  config: {
    model: { provider: 'test', modelID: 'model' },
    tools: { enabled: [] },
  },
  apiKeys: {},
  databaseUrl: 'file:///tmp/app.db',
  migrationsPath: '/tmp/drizzle',
  sessionDir: '/tmp/sessions',
  allowedOrigins: [],
  transport: 'http',
}

class FakeUtilityProcess extends EventEmitter implements UtilityProcessLike {
  readonly messages: MainToAgentBackendMessage[] = []
  killed = false

  postMessage(message: unknown): void {
    const typedMessage = message as MainToAgentBackendMessage
    this.messages.push(typedMessage)
    if (typedMessage.type === 'initialize') {
      queueMicrotask(() =>
        this.emit('message', {
          type: 'ready',
          info: { baseUrl: 'http://127.0.0.1:12345/x/api/pi', transport: 'http' },
        }),
      )
    } else if (typedMessage.type === 'request') {
      queueMicrotask(() =>
        this.emit('message', { type: 'response', id: typedMessage.id, ok: true, value: 'done' }),
      )
    }
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

const processes: FakeUtilityProcess[] = []

afterEach(() => {
  processes.length = 0
})

function makeProcess() {
  const child = new FakeUtilityProcess()
  processes.push(child)
  const backend = new AgentBackendProcess('/agent-backend-entry.mjs', () => child)
  return { backend, child }
}

test('waits for backend readiness, proxies low-frequency requests, and kills the child on close', async () => {
  const { backend, child } = makeProcess()
  const status = await backend.start(options)
  expect(status).toEqual({
    state: 'ready',
    info: { baseUrl: 'http://127.0.0.1:12345/x/api/pi', transport: 'http' },
  })

  await expect(backend.request({ action: 'context:clear' })).resolves.toBe('done')
  expect(child.messages[0]?.type).toBe('initialize')
  expect(child.messages[1]).toMatchObject({ type: 'request', action: 'context:clear' })

  backend.close()
  expect(child.killed).toBe(true)
  expect(child.messages.at(-1)).toEqual({ type: 'shutdown' })
})

test('forwards Pi events over a temporary IPC subscription and unsubscribes on cleanup', async () => {
  const { backend, child } = makeProcess()
  await backend.start(options)
  const listener = vi.fn()
  const unsubscribe = backend.subscribePi({ threadId: 'thread-1' }, listener)
  const subscribeMessage = child.messages.at(-1)
  expect(subscribeMessage).toMatchObject({
    type: 'pi:subscribe',
    request: { threadId: 'thread-1' },
  })
  if (subscribeMessage?.type !== 'pi:subscribe') throw new Error('Expected Pi subscription')

  const event = { type: 'snapshot', threadId: 'thread-1', seq: 0, snapshot: {} }
  child.emit('message', {
    type: 'pi:event',
    subscriptionId: subscribeMessage.subscriptionId,
    event,
  })
  expect(listener).toHaveBeenCalledWith(event)

  unsubscribe()
  expect(child.messages.at(-1)).toEqual({
    type: 'pi:unsubscribe',
    subscriptionId: subscribeMessage.subscriptionId,
  })
  backend.close()
})

test('marks the backend unavailable when its process exits unexpectedly', async () => {
  const { backend, child } = makeProcess()
  const listener = vi.fn()
  backend.onStatusChange(listener)
  await backend.start(options)

  child.emit('exit', 1)

  expect(backend.getStatus()).toEqual({
    state: 'unavailable',
    message: 'Agent backend stopped unexpectedly.',
  })
  expect(listener).toHaveBeenLastCalledWith(backend.getStatus())
  await expect(backend.request({ action: 'context:clear' })).rejects.toThrow(
    'Agent backend is unavailable.',
  )
})
