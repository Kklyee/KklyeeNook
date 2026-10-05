import { expect, test, vi } from 'vitest'

import type { PiAssistantMessage, PiClientEvent, PiClientEventBody, PiThreadMetadata } from '@assistant-ui/react-pi/node'
import { createPiHttpClient, createPiThreadState, reducePiThreadState } from '@assistant-ui/react-pi'
import { startAgentHttpServer } from '@/main/agent-backend/httpServer'
import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { AgentService } from '../../agentService'
import type { MessageProjectionService } from '../../messageProjectionService'
import { ContextAttachmentService } from '@/main/context/contextAttachmentService'
import { ContextBuilder } from '@/main/context/contextBuilder'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { PiSessionClientEventListener, PiSessionRuntimePort } from '../runtime/piSessionRuntime'
import { PiSessionRuntimeManager } from '../runtime/piSessionRuntimeManager'
import { PiClientService } from './piClientService'

function assistantMessage(text: string): PiAssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text }],
    api: 'openai-completions', provider: 'test', model: 'test', stopReason: 'stop', timestamp: 2,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
}

function setup(running = false) {
  const session: AgentSessionSummary = {
    id: 'session-1',
    title: 'Task',
    createdAt: 1,
    updatedAt: 2,
    archived: false,
  }
  const clientListeners = new Set<PiSessionClientEventListener>()
  const sessionRuntime: PiSessionRuntimePort = {
    initialize: vi.fn(),
    getSystemPrompt: vi.fn(() => 'system'),
    getContextUsage: vi.fn(() => undefined),
    getSnapshot: vi.fn((metadata: PiThreadMetadata) => ({
      metadata,
      messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
    })),
    isRunning: vi.fn(() => running),
    sendMessage: vi.fn(),
    compact: vi.fn(),
    runMessage: vi.fn(),
    cancel: vi.fn(),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    updateQueuedMessage: vi.fn(() => ({ steering: [], followUp: [] })),
    getAvailableModels: vi.fn(() => Promise.resolve([])),
    applyConfiguredModelSelection: vi.fn(),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    respondToExtensionUiRequest: vi.fn(),
    reloadConfiguration: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    subscribeClientEvents(listener) {
      clientListeners.add(listener)
      return () => clientListeners.delete(listener)
    },
    subscribeProductEvents: vi.fn(() => () => undefined),
    subscribeExecutionEvents: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  }
  const completion = Promise.resolve({
    id: 'run-1',
    sessionId: session.id,
    status: 'completed' as const,
    createdAt: 1,
    updatedAt: 2,
    toolCalls: [],
    toolResults: [],
  })
  const agentService = {
    listSessions: vi.fn(() => Promise.resolve([session])),
    getSession: vi.fn(() => ({ toSummary: () => session })),
    createSession: vi.fn(() => Promise.resolve(session)),
    renameSession: vi.fn(),
    setSessionArchived: vi.fn(),
    deleteSession: vi.fn(),
    steerRun: vi.fn(),
    discardPendingInputs: vi.fn(),
    startRun: vi.fn(() => ({ run: {}, completion })),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as AgentService
  const projection = { project: vi.fn() } as unknown as MessageProjectionService
  const contextAttachments = new ContextAttachmentService()
  const manager = new PiSessionRuntimeManager(() => sessionRuntime)
  const client = new PiClientService(
    agentService,
    manager,
    projection,
    new AgentConfigStore({ model: { provider: 'test', modelID: 'test', thinkingLevel: 'off' } }),
    new ContextBuilder(contextAttachments),
    contextAttachments,
  )
  return {
    client,
    sessionRuntime,
    agentService,
    projection,
    contextAttachments,
    emit(body: PiClientEventBody) {
      for (const listener of clientListeners) listener(body)
    },
  }
}

test('delivers snapshot-first events and unsubscribe does not cancel the run', async () => {
  const { client, sessionRuntime, emit } = setup()
  const events: string[] = []
  const unsubscribe = client.subscribe('session-1', (event) => events.push(event.type))
  await vi.waitFor(() => expect(events).toEqual(['snapshot']))

  emit({ type: 'agent_start' })
  expect(events).toEqual(['snapshot', 'agent_start'])
  unsubscribe()
  emit({ type: 'agent_settled' })

  expect(events).toEqual(['snapshot', 'agent_start'])
  expect(sessionRuntime.cancel).not.toHaveBeenCalled()
  await client.cancelRun('session-1')
  expect(sessionRuntime.cancel).toHaveBeenCalledOnce()
})

test('receives live events while the session subscription is still initializing', async () => {
  const { client, sessionRuntime, emit } = setup()
  let finishInitialization!: () => void
  vi.mocked(sessionRuntime.initialize).mockImplementation(() => new Promise<void>((resolve) => {
    finishInitialization = resolve
  }))
  const events: string[] = []
  const unsubscribe = client.subscribe('session-1', (event) => events.push(event.type), { includeSnapshot: false })

  emit({ type: 'agent_start' })
  emit({ type: 'message_start', message: { role: 'user', content: 'hello', timestamp: 1 } })

  expect(events).toEqual(['agent_start', 'message_start'])
  finishInitialization()
  await Promise.resolve()
  unsubscribe()
  client.dispose()
})

test('publishes the native summary snapshot after compaction without adding a user message', async () => {
  const { client, sessionRuntime, emit, projection } = setup()
  const events: PiClientEvent[] = []
  const unsubscribe = client.subscribe('session-1', (event) => events.push(event))
  await vi.waitFor(() => expect(events).toHaveLength(1))
  const summary = {
    role: 'compactionSummary' as const,
    summary: 'Preserved decisions',
    tokensBefore: 42000,
    timestamp: 3,
  }
  vi.mocked(sessionRuntime.getSnapshot).mockImplementation((metadata) => ({
    metadata,
    messages: [summary],
  }))

  emit({ type: 'compaction_start', reason: 'manual' })
  emit({ type: 'compaction_end', aborted: false, willRetry: false })

  expect(events.map((event) => event.type)).toEqual([
    'snapshot',
    'compaction_start',
    'compaction_end',
    'snapshot',
  ])
  expect(events.at(-1)).toMatchObject({ type: 'snapshot', snapshot: { messages: [summary] } })
  expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3])
  expect(sessionRuntime.sendMessage).not.toHaveBeenCalled()
  expect(projection.project).not.toHaveBeenCalled()
  unsubscribe()
  client.dispose()
})

test('returns snapshots without rewriting the persisted transcript', async () => {
  const { client, projection } = setup()
  const snapshot = await client.getThread('session-1')
  const events: string[] = []
  const unsubscribe = client.subscribe('session-1', (event) => events.push(event.type))
  await vi.waitFor(() => expect(events).toEqual(['snapshot']))

  expect(snapshot.messages).toHaveLength(1)
  expect(projection.project).not.toHaveBeenCalled()
  unsubscribe()
  client.dispose()
})

test('reads current run metadata after the runtime finishes initializing', async () => {
  const { client, sessionRuntime, agentService } = setup()
  let session = agentService.getSession('session-1')!.toSummary()
  vi.mocked(agentService.getSession).mockImplementation(() => ({ toSummary: () => ({ ...session }) }) as never)
  let finishInitialization!: () => void
  vi.mocked(sessionRuntime.initialize).mockImplementation(() => new Promise<void>((resolve) => {
    finishInitialization = resolve
  }))
  const snapshot = client.getThread('session-1')
  session = { ...session, activeRunId: 'run-1' }
  finishInitialization()
  expect((await snapshot).metadata).toMatchObject({ status: 'running', runningRunId: 'run-1' })
  client.dispose()
})

test('coalesces streaming text and flushes the latest update before message completion', async () => {
  vi.useFakeTimers()
  const { client, emit } = setup()
  try {
    const events: PiClientEvent[] = []
    client.subscribe('session-1', (event) => events.push(event), { includeSnapshot: false })
    emit({ type: 'agent_start' })
    for (let index = 1; index <= 100; index += 1) {
      const message = assistantMessage(`chunk ${index}`)
      emit({
        type: 'message_update',
        message,
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'x', partial: message },
      })
    }
    expect(events.map((event) => event.type)).toEqual(['agent_start'])
    await vi.advanceTimersByTimeAsync(32)
    expect(events.map((event) => event.type)).toEqual(['agent_start', 'message_update'])
    expect(events[1]).toMatchObject({ message: { content: [{ text: 'chunk 100' }] } })

    const finalMessage = assistantMessage('final')
    emit({
      type: 'message_update',
      message: finalMessage,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'final', partial: finalMessage },
    })
    emit({ type: 'message_end', message: finalMessage })
    expect(events.map((event) => event.type)).toEqual(['agent_start', 'message_update', 'message_update', 'message_end'])
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    await vi.advanceTimersByTimeAsync(32)
    expect(events).toHaveLength(4)
  } finally {
    client.dispose()
    vi.useRealTimers()
  }
})

test('delivers coalesced streaming content intact through HTTP and the installed Pi reducer', async () => {
  const { client, emit } = setup()
  const server = await startAgentHttpServer(client)
  const onStreamError = vi.fn()
  const httpClient = createPiHttpClient({ baseUrl: server.baseUrl, streamCloseDelayMs: 0, onStreamError })
  let state = createPiThreadState('session-1')
  const events: PiClientEvent[] = []
  const unsubscribe = httpClient.subscribe('session-1', (event) => {
    events.push(event)
    state = reducePiThreadState(state, event)
  })
  try {
    await vi.waitFor(() => expect(state.loadState).toBe('loaded'))
    emit({ type: 'agent_start' })
    const userMessage = { role: 'user' as const, content: 'new prompt', timestamp: 2 }
    emit({ type: 'message_start', message: userMessage })
    emit({ type: 'message_end', message: userMessage })
    emit({ type: 'message_start', message: assistantMessage('') })
    for (let index = 1; index <= 100; index += 1) {
      const message = assistantMessage(`token ${index}`)
      emit({ type: 'message_update', message, assistantMessageEvent: {
        type: 'text_delta', contentIndex: 0, delta: 'x', partial: message,
      } })
    }
    emit({ type: 'message_end', message: assistantMessage('token 100') })
    emit({ type: 'agent_end' })

    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('agent_end'))
    expect(state.runStatus).toBe('idle')
    expect(state.messages).toHaveLength(3)
    expect(state.messages[1]).toEqual(userMessage)
    expect(state.messages[2]).toMatchObject({ content: [{ type: 'text', text: 'token 100' }] })
    expect(events.filter((event) => event.type === 'message_update')).toHaveLength(1)
    expect(onStreamError).not.toHaveBeenCalled()
  } finally {
    unsubscribe()
    client.dispose()
    await server.close()
  }
})

test('keeps concurrent tool updates separate and discards pending updates on disposal', async () => {
  vi.useFakeTimers()
  const { client, emit } = setup()
  try {
    const events: PiClientEvent[] = []
    client.subscribe('session-1', (event) => events.push(event), { includeSnapshot: false })
    emit({ type: 'tool_execution_update', toolCallId: 'tool-1', partialResult: 'old' })
    emit({ type: 'tool_execution_update', toolCallId: 'tool-2', partialResult: 'other' })
    emit({ type: 'tool_execution_update', toolCallId: 'tool-1', partialResult: 'latest' })
    emit({ type: 'tool_execution_end', toolCallId: 'tool-1', result: 'done', isError: false })

    expect(events).toMatchObject([
      { type: 'tool_execution_update', toolCallId: 'tool-1', partialResult: 'latest' },
      { type: 'tool_execution_update', toolCallId: 'tool-2', partialResult: 'other' },
      { type: 'tool_execution_end', toolCallId: 'tool-1' },
    ])
    emit({ type: 'tool_execution_update', toolCallId: 'tool-2', partialResult: 'pending' })
    client.dispose()
    await vi.advanceTimersByTimeAsync(32)
    expect(events).toHaveLength(3)
  } finally {
    client.dispose()
    vi.useRealTimers()
  }
})

test('starts a product run for an idle thread and uses Pi queue while running', async () => {
  const idle = setup()
  await idle.client.sendMessage('session-1', { content: 'hello' })
  expect(idle.agentService.startRun).toHaveBeenCalledWith('session-1', { prompt: 'hello' })

  const running = setup(true)
  await running.client.sendMessage('session-1', { content: 'follow up' })
  expect(running.sessionRuntime.sendMessage).toHaveBeenCalledWith({
    content: 'follow up',
    streamingBehavior: 'followUp',
  })
  expect(running.agentService.steerRun).toHaveBeenCalledWith('session-1', 'follow up', 'follow-up')
})

test('preserves follow-up delivery and releases pending inputs when the Pi queue is cleared', async () => {
  const running = setup(true)
  await running.client.sendMessage('session-1', { content: 'later', streamingBehavior: 'followUp' })
  expect(running.agentService.steerRun).toHaveBeenCalledWith('session-1', 'later', 'follow-up')
  expect(running.sessionRuntime.sendMessage).toHaveBeenCalledWith({ content: 'later', streamingBehavior: 'followUp' })
  await running.client.clearQueue('session-1')
  expect(running.agentService.discardPendingInputs).toHaveBeenCalledWith('session-1')
})

test('rebuilds pending input correlation from the native queue after a mutation', async () => {
  const running = setup(true)
  await running.client.sendMessage('session-1', { content: 'first' })
  vi.mocked(running.sessionRuntime.updateQueuedMessage).mockReturnValue({ steering: ['now'], followUp: ['edited', 'last'] })
  const input = { mode: 'followUp' as const, expected: ['first', 'last'], index: 0, action: 'edit' as const, value: 'edited' }
  expect(await running.client.updateQueuedMessage('session-1', input)).toEqual({ steering: ['now'], followUp: ['edited', 'last'] })
  expect(running.sessionRuntime.updateQueuedMessage).toHaveBeenCalledWith(input)
  expect(running.agentService.discardPendingInputs).toHaveBeenCalledWith('session-1')
  expect(vi.mocked(running.agentService.steerRun).mock.calls.slice(-3)).toEqual([
    ['session-1', 'now', 'steer'], ['session-1', 'edited', 'follow-up'], ['session-1', 'last', 'follow-up'],
  ])
})

test('resolves staged file context before starting an idle product run', async () => {
  const testContext = setup()
  const text = 'Use this note as context.'
  const attachment = testContext.contextAttachments.stage({
    name: 'note.txt',
    mimeType: 'text/plain',
    size: Buffer.byteLength(text),
    text,
  })

  await testContext.client.sendMessage('session-1', { content: 'Summarize it' }, [attachment.id])

  expect(testContext.agentService.startRun).toHaveBeenCalledWith('session-1', {
    prompt: 'Summarize it',
    context: { attachments: [{ ...attachment, text }] },
  })
  expect(() => testContext.contextAttachments.resolve([attachment.id])).toThrow(
    `Context attachment not found: ${attachment.id}`,
  )
})

test('forwards image attachments to an idle product run', async () => {
  const testContext = setup()
  const attachments = [{ type: 'image' as const, mimeType: 'image/png', data: 'base64-image' }]

  await testContext.client.sendMessage('session-1', {
    content: 'Describe this image',
    attachments,
  })

  expect(testContext.agentService.startRun).toHaveBeenCalledWith('session-1', {
    prompt: 'Describe this image',
    attachments,
  })
})

test('initializes a new thread before synchronizing its generated title to Pi', async () => {
  const testContext = setup()
  const session = testContext.agentService.getSession('session-1')!.toSummary()
  session.title = 'New Task'

  await testContext.client.sendMessage('session-1', { content: 'First prompt' })

  expect(testContext.sessionRuntime.initialize).toHaveBeenCalledBefore(
    vi.mocked(testContext.sessionRuntime.setSessionName),
  )
  expect(testContext.sessionRuntime.setSessionName).toHaveBeenCalledWith('First prompt')
})

test('projects the Pi transcript after a completed message', async () => {
  const { client, emit, projection } = setup()
  const unsubscribe = client.subscribe('session-1', () => undefined)
  emit({ type: 'message_end', message: { role: 'user', content: 'hello', timestamp: 1 } })
  await vi.waitFor(() => expect(projection.project).toHaveBeenCalled())
  unsubscribe()
})

test('does not rewrite chat messages when a tool result completes', () => {
  const { client, emit, projection } = setup()
  client.subscribe('session-1', () => undefined, { includeSnapshot: false })
  emit({ type: 'message_end', message: {
    role: 'toolResult', toolCallId: 'tool-1', toolName: 'read', content: [], isError: false, timestamp: 1,
  } })
  expect(projection.project).not.toHaveBeenCalled()
  client.dispose()
})

test('forwards thread controls, queue controls, model settings, and host UI responses', async () => {
  const { client, sessionRuntime, agentService } = setup()
  const response = { requestId: 'approval-1', value: 'Allow once' } as const

  await client.getThread('session-1')
  expect(sessionRuntime.applyConfiguredModelSelection).toHaveBeenCalledOnce()
  await client.cancelRun('session-1')
  expect(await client.clearQueue('session-1')).toEqual({ steering: [], followUp: [] })
  await client.setModel('session-1', { provider: 'test', modelId: 'next' })
  await client.setThinkingLevel('session-1', 'high')
  await client.respondToHostUiRequest('session-1', response)
  await client.renameThread('session-1', 'Renamed')
  await client.archiveThread('session-1')
  await client.unarchiveThread('session-1')

  expect(sessionRuntime.cancel).toHaveBeenCalledOnce()
  expect(sessionRuntime.clearQueue).toHaveBeenCalledOnce()
  expect(sessionRuntime.setModel).toHaveBeenCalledWith({ provider: 'test', modelId: 'next' })
  expect(sessionRuntime.setThinkingLevel).toHaveBeenCalledWith('high')
  expect(sessionRuntime.respondToExtensionUiRequest).toHaveBeenCalledWith(response)
  expect(sessionRuntime.setSessionName).toHaveBeenCalledWith('Renamed')
  expect(agentService.setSessionArchived).toHaveBeenNthCalledWith(1, 'session-1', true)
  expect(agentService.setSessionArchived).toHaveBeenNthCalledWith(2, 'session-1', false)

  await client.deleteThread('session-1')
  expect(agentService.deleteSession).toHaveBeenCalledWith('session-1')
  expect(sessionRuntime.dispose).toHaveBeenCalledOnce()
})
