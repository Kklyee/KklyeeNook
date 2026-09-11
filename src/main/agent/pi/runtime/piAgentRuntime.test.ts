import { expect, test, vi } from 'vitest'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import { PiAgentRuntime } from './piAgentRuntime'
import type {
  PiSessionEventListener,
  PiSessionHostLike,
  PiSessionProductEventListener,
} from './piSessionHost'

test('keeps the legacy AgentRuntime projection on top of the shared host', async () => {
  const sessionListeners = new Set<PiSessionEventListener>()
  const productListeners = new Set<PiSessionProductEventListener>()
  const unsubscribeSession = vi.fn()
  const unsubscribeProductEvents = vi.fn()
  const host: PiSessionHostLike = {
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
    respondToHostUiRequest: vi.fn(),
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
  const disposeHost = vi.fn()
  const runtime = new PiAgentRuntime(host, disposeHost)
  const events: AgentEvent[] = []

  await runtime.run('hello', (event) => events.push(event))
  runtime.dispose()

  expect(host.initialize).toHaveBeenCalledOnce()
  expect(events.map((event) => event.type)).toEqual([
    'system_prompt',
    'agent_started',
    'approval_required',
    'agent_completed',
  ])
  expect(unsubscribeSession).toHaveBeenCalledOnce()
  expect(unsubscribeProductEvents).toHaveBeenCalledOnce()
  expect(disposeHost).toHaveBeenCalledOnce()
})
