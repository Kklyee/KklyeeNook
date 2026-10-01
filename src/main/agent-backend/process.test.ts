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
}

class FakeUtilityProcess extends EventEmitter implements UtilityProcessLike {
  readonly messages: MainToAgentBackendMessage[] = []
  killed = false

  constructor() {
    super()
    queueMicrotask(() => this.emit('spawn'))
  }

  postMessage(message: unknown): void {
    const typedMessage = message as MainToAgentBackendMessage
    this.messages.push(typedMessage)
    if (typedMessage.type === 'initialize') {
      queueMicrotask(() =>
        this.emit('message', {
        type: 'ready',
        info: { baseUrl: 'http://127.0.0.1:12345/x/api/pi' },
        }),
      )
    } else if (typedMessage.type === 'request') {
      queueMicrotask(() =>
        this.emit('message', { type: 'response', id: typedMessage.requestId, ok: true, value: 'done' }),
      )
    }
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

class SpawnGatedUtilityProcess extends EventEmitter implements UtilityProcessLike {
  readonly messages: MainToAgentBackendMessage[] = []
  killed = false
  private spawned = false

  constructor(private readonly readyAfterSpawn = true) {
    super()
  }

  postMessage(message: unknown): void {
    const typedMessage = message as MainToAgentBackendMessage
    this.messages.push(typedMessage)
    if (typedMessage.type === 'initialize' && this.spawned && this.readyAfterSpawn) {
      queueMicrotask(() =>
        this.emit('message', {
          type: 'ready',
          info: { baseUrl: 'http://127.0.0.1:12345/x/api/pi' },
        }),
      )
    }
  }

  emitSpawn(): void {
    this.spawned = true
    this.emit('spawn')
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

test('waits for backend readiness, proxies requests, and lets the backend finish shutdown', async () => {
  const { backend, child } = makeProcess()
  const status = await backend.start(options)
  expect(status).toEqual({
    state: 'ready',
    info: { baseUrl: 'http://127.0.0.1:12345/x/api/pi' },
  })

  await expect(backend.request({ action: 'context:clear' })).resolves.toBe('done')
  expect(child.messages[0]?.type).toBe('initialize')
  expect(child.messages[1]).toMatchObject({
    type: 'request',
    action: 'context:clear',
  })

  const closed = backend.close()
  expect(child.killed).toBe(false)
  expect(child.messages.at(-1)).toEqual({ type: 'shutdown' })
  child.emit('exit', 0)
  await closed
  expect(child.killed).toBe(false)
})

test('kills an unresponsive backend after the shutdown deadline', async () => {
  vi.useFakeTimers()
  try {
    const { backend, child } = makeProcess()
    await backend.start(options)
    const closed = backend.close()
    expect(backend.close()).toBe(closed)
    await vi.advanceTimersByTimeAsync(10_000)
    await closed
    expect(child.killed).toBe(true)
  } finally {
    vi.useRealTimers()
  }
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

test('starts the initialization timeout after the utility process spawns', async () => {
  vi.useFakeTimers()
  const child = new SpawnGatedUtilityProcess()
  const backend = new AgentBackendProcess('/agent-backend-entry.mjs', () => child)

  try {
    const startPromise = backend.start(options, 10)
    await vi.advanceTimersByTimeAsync(20)

    expect(backend.getStatus()).toEqual({ state: 'starting' })
    expect(child.killed).toBe(false)

    child.emitSpawn()

    await expect(startPromise).resolves.toEqual({
      state: 'ready',
      info: { baseUrl: 'http://127.0.0.1:12345/x/api/pi' },
    })
  } finally {
    backend.close()
    child.emit('exit', 0)
    vi.useRealTimers()
  }
})

test('prints the last startup stage when initialization times out', async () => {
  vi.useFakeTimers()
  const child = new SpawnGatedUtilityProcess(false)
  const backend = new AgentBackendProcess('/agent-backend-entry.mjs', () => child)
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  try {
    const startPromise = backend.start(options, 10)
    child.emitSpawn()
    child.emit('message', { type: 'startup-stage', stage: 'database_connected' })
    await vi.advanceTimersByTimeAsync(10)

    await expect(startPromise).resolves.toEqual({
      state: 'unavailable',
      message: 'Agent backend start timed out.',
    })
    expect(error).toHaveBeenCalledWith(
      '[agent-backend] start timed out after 10ms; last startup stage: database_connected',
    )
  } finally {
    error.mockRestore()
    backend.close()
    child.emit('exit', 0)
    vi.useRealTimers()
  }
})

test('permission changes return without timing out when the conversation has an id', async () => {
  const { backend, child } = makeProcess()
  await backend.start(options)
  try {
    await expect(
      backend.request(
        { action: 'conversation:permission', id: 'conversation-1', mode: 'full-access' },
        50,
      ),
    ).resolves.toBe('done')
  } finally {
    const closed = backend.close()
    child.emit('exit', 0)
    await closed
  }
})
