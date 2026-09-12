import { expect, test, vi } from 'vitest'

import type { PiSessionRuntimePort } from './piSessionRuntime'
import { PiSessionRuntimeManager } from './piSessionRuntimeManager'

function createFakeRuntime(): PiSessionRuntimePort {
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
    respondToExtensionUiRequest: vi.fn(),
    reloadConfiguration: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    subscribeClientEvents: vi.fn(() => () => undefined),
    subscribeProductEvents: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  }
}

test('returns one runtime for each product session', () => {
  const createRuntime = vi.fn(() => createFakeRuntime())
  const manager = new PiSessionRuntimeManager(createRuntime)

  const first = manager.getOrCreate('session-1')
  const second = manager.getOrCreate('session-1')

  expect(second).toBe(first)
  expect(createRuntime).toHaveBeenCalledOnce()
  expect(createRuntime).toHaveBeenCalledWith('session-1')
})

test('disposes a deleted runtime before allowing it to be recreated', () => {
  const runtimes = [createFakeRuntime(), createFakeRuntime()]
  const manager = new PiSessionRuntimeManager(() => runtimes.shift()!)
  const first = manager.getOrCreate('session-1')

  manager.delete('session-1')
  const second = manager.getOrCreate('session-1')

  expect(first.dispose).toHaveBeenCalledOnce()
  expect(second).not.toBe(first)
})

test('disposes every owned runtime on shutdown', () => {
  const first = createFakeRuntime()
  const second = createFakeRuntime()
  const manager = new PiSessionRuntimeManager((sessionId) =>
    sessionId === 'session-1' ? first : second,
  )
  manager.getOrCreate('session-1')
  manager.getOrCreate('session-2')

  manager.dispose()

  expect(first.dispose).toHaveBeenCalledOnce()
  expect(second.dispose).toHaveBeenCalledOnce()
})

test('reloads idle runtimes and refuses to split state from an active run', () => {
  const idle = createFakeRuntime()
  const active = createFakeRuntime()
  vi.mocked(active.isRunning).mockReturnValue(true)
  const manager = new PiSessionRuntimeManager((sessionId) => (sessionId === 'idle' ? idle : active))
  manager.getOrCreate('idle')
  manager.reloadConfiguration()
  expect(idle.reloadConfiguration).toHaveBeenCalledOnce()

  manager.getOrCreate('active')
  expect(() => manager.reloadConfiguration()).toThrow('当前 Agent 运行结束')
  expect(active.reloadConfiguration).not.toHaveBeenCalled()
})
