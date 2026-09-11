import { expect, test, vi } from 'vitest'

import type { PiSessionHostLike } from './piSessionHost'
import { PiSessionHostManager } from './piSessionHostManager'

function createFakeHost(): PiSessionHostLike {
  return {
    initialize: vi.fn(),
    getSystemPrompt: vi.fn(() => ''),
    getSnapshot: vi.fn(),
    isRunning: vi.fn(() => false),
    sendMessage: vi.fn(),
    runMessage: vi.fn(),
    cancel: vi.fn(),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    getAvailableModels: vi.fn(() => Promise.resolve([])),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    respondToHostUiRequest: vi.fn(),
    reloadConfiguration: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    subscribeClientEvents: vi.fn(() => () => undefined),
    subscribeProductEvents: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  }
}

test('returns one host for each product session', () => {
  const createHost = vi.fn(() => createFakeHost())
  const manager = new PiSessionHostManager(createHost)

  const first = manager.getOrCreate('session-1')
  const second = manager.getOrCreate('session-1')

  expect(second).toBe(first)
  expect(createHost).toHaveBeenCalledOnce()
  expect(createHost).toHaveBeenCalledWith('session-1')
})

test('disposes a deleted host before allowing it to be recreated', () => {
  const hosts = [createFakeHost(), createFakeHost()]
  const manager = new PiSessionHostManager(() => hosts.shift()!)
  const first = manager.getOrCreate('session-1')

  manager.delete('session-1')
  const second = manager.getOrCreate('session-1')

  expect(first.dispose).toHaveBeenCalledOnce()
  expect(second).not.toBe(first)
})

test('disposes every owned host on shutdown', () => {
  const first = createFakeHost()
  const second = createFakeHost()
  const manager = new PiSessionHostManager((sessionId) =>
    sessionId === 'session-1' ? first : second,
  )
  manager.getOrCreate('session-1')
  manager.getOrCreate('session-2')

  manager.dispose()

  expect(first.dispose).toHaveBeenCalledOnce()
  expect(second.dispose).toHaveBeenCalledOnce()
})

test('reloads idle hosts and refuses to split state from an active run', () => {
  const idle = createFakeHost()
  const active = createFakeHost()
  vi.mocked(active.isRunning).mockReturnValue(true)
  const manager = new PiSessionHostManager((sessionId) => (sessionId === 'idle' ? idle : active))
  manager.getOrCreate('idle')
  manager.reloadConfiguration()
  expect(idle.reloadConfiguration).toHaveBeenCalledOnce()

  manager.getOrCreate('active')
  expect(() => manager.reloadConfiguration()).toThrow('当前 Agent 运行结束')
  expect(active.reloadConfiguration).not.toHaveBeenCalled()
})
