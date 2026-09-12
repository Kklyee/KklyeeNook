import { expect, test, vi } from 'vitest'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import { PiAgentRuntime } from './piAgentRuntime'
import type {
  PiSessionEventListener,
  PiSessionRuntimePort,
  PiSessionProductEventListener,
} from './piSessionRuntime'

test('keeps the AgentRuntime projection on top of the shared session runtime', async () => {
  const sessionListeners = new Set<PiSessionEventListener>()
  const productListeners = new Set<PiSessionProductEventListener>()
  const unsubscribeSession = vi.fn()
  const unsubscribeProductEvents = vi.fn()
  const sessionRuntime: PiSessionRuntimePort = {
    initialize: vi.fn(),
    getSystemPrompt: vi.fn(() => 'system'),
    getSnapshot: vi.fn(),
    isRunning: vi.fn(() => false),
    sendMessage: vi.fn(),
    async runMessage() {
      for (const listener of sessionListeners) listener({ type: 'agent_start' })
      for (const listener of productListeners) {
        listener({
          type: 'approval_required',
          approvalId: 'approval-1',
          call: { id: 'tool-1', toolName: 'write', args: {} },
        })
      }
    },
    cancel: vi.fn(),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    getAvailableModels: vi.fn(() => Promise.resolve([])),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    respondToExtensionUiRequest: vi.fn(),
    reloadConfiguration: vi.fn(),
    subscribe(listener) {
      sessionListeners.add(listener)
      return unsubscribeSession
    },
    subscribeProductEvents(listener) {
      productListeners.add(listener)
      return unsubscribeProductEvents
    },
    subscribeClientEvents: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  }
  const disposeRuntime = vi.fn()
  const runtime = new PiAgentRuntime(sessionRuntime, disposeRuntime)
  const events: AgentEvent[] = []

  await runtime.run('hello', (event) => events.push(event))
  runtime.dispose()

  expect(sessionRuntime.initialize).toHaveBeenCalledOnce()
  expect(events.map((event) => event.type)).toEqual([
    'system_prompt',
    'agent_started',
    'approval_required',
    'agent_completed',
  ])
  expect(unsubscribeSession).toHaveBeenCalledOnce()
  expect(unsubscribeProductEvents).toHaveBeenCalledOnce()
  expect(disposeRuntime).toHaveBeenCalledOnce()
})
