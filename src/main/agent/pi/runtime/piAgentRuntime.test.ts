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
  const runMessage = vi.fn(async () => {
    for (const listener of sessionListeners) listener({ type: 'agent_start' })
    for (const listener of productListeners) {
      listener({
        type: 'approval_required',
        approvalId: 'approval-1',
        call: { id: 'tool-1', toolName: 'write', args: {} },
      })
    }
  })
  const sessionRuntime: PiSessionRuntimePort = {
    initialize: vi.fn(),
    getSystemPrompt: vi.fn(() => 'system'),
    getSnapshot: vi.fn(),
    isRunning: vi.fn(() => false),
    sendMessage: vi.fn(),
    runMessage,
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

  const context = {
    attachments: [
      {
        id: 'attachment-1',
        name: 'notes.md',
        mimeType: 'text/markdown',
        size: 5,
        text: 'notes',
      },
    ],
  }
  await runtime.run({ prompt: 'hello', context }, (event) => events.push(event))
  runtime.dispose()

  expect(sessionRuntime.initialize).toHaveBeenCalledOnce()
  expect(runMessage).toHaveBeenCalledWith({ content: 'hello' }, context)
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

test('passes image attachments through to the Pi session runtime', async () => {
  const runMessage = vi.fn(async () => undefined)
  const sessionRuntime: PiSessionRuntimePort = {
    initialize: vi.fn(),
    getSystemPrompt: vi.fn(() => 'system'),
    getSnapshot: vi.fn(),
    isRunning: vi.fn(() => false),
    sendMessage: vi.fn(),
    runMessage,
    cancel: vi.fn(),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    getAvailableModels: vi.fn(() => Promise.resolve([])),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    respondToExtensionUiRequest: vi.fn(),
    reloadConfiguration: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    subscribeProductEvents: vi.fn(() => () => undefined),
    subscribeClientEvents: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  }
  const runtime = new PiAgentRuntime(sessionRuntime, vi.fn())
  const attachments = [{ type: 'image' as const, mimeType: 'image/png', data: 'base64-image' }]

  await runtime.run({ prompt: 'Describe this image', attachments }, vi.fn())

  expect(runMessage).toHaveBeenCalledWith(
    { content: 'Describe this image', attachments },
    undefined,
  )
})
