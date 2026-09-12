import { expect, test, vi } from 'vitest'

import type { PiClientEventBody, PiThreadMetadata } from '@assistant-ui/react-pi/node'
import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { AgentService } from '../../agentService'
import type { MessageProjectionService } from '../../messageProjectionService'
import type { ArtifactService } from '@/main/artifact/artifactService'
import { ContextAttachmentService } from '@/main/context/contextAttachmentService'
import { ContextBuilder } from '@/main/context/contextBuilder'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { PiSessionClientEventListener, PiSessionRuntimePort } from '../runtime/piSessionRuntime'
import { PiSessionRuntimeManager } from '../runtime/piSessionRuntimeManager'
import { PiClientService } from './piClientService'

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
    getSnapshot: vi.fn((metadata: PiThreadMetadata) => ({
      metadata,
      messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
    })),
    isRunning: vi.fn(() => running),
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
    subscribeClientEvents(listener) {
      clientListeners.add(listener)
      return () => clientListeners.delete(listener)
    },
    subscribeProductEvents: vi.fn(() => () => undefined),
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
    artifactIds: [],
  })
  const agentService = {
    listSessions: vi.fn(() => Promise.resolve([session])),
    getSession: vi.fn(() => ({ toSummary: () => session })),
    createSession: vi.fn(() => Promise.resolve(session)),
    renameSession: vi.fn(),
    setSessionArchived: vi.fn(),
    deleteSession: vi.fn(),
    steerRun: vi.fn(),
    startRun: vi.fn(() => ({ run: {}, completion })),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as AgentService
  const projection = { project: vi.fn() } as unknown as MessageProjectionService
  const artifacts = { list: vi.fn(() => Promise.resolve([])) } as unknown as ArtifactService
  const contextAttachments = new ContextAttachmentService()
  const manager = new PiSessionRuntimeManager(() => sessionRuntime)
  const client = new PiClientService(
    agentService,
    manager,
    projection,
    new AgentConfigStore({ model: { provider: 'test', modelID: 'test', thinkingLevel: 'off' } }),
    artifacts,
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

test('starts a product run for an idle thread and uses Pi queue while running', async () => {
  const idle = setup()
  await idle.client.sendMessage('session-1', { content: 'hello' })
  expect(idle.agentService.startRun).toHaveBeenCalledWith('session-1', { prompt: 'hello' })

  const running = setup(true)
  await running.client.sendMessage('session-1', { content: 'follow up' })
  expect(running.sessionRuntime.sendMessage).toHaveBeenCalledWith({
    content: 'follow up',
    streamingBehavior: 'steer',
  })
  expect(running.agentService.steerRun).toHaveBeenCalledWith('session-1', 'follow up')
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
  await vi.waitFor(() => expect(projection.project).toHaveBeenCalled())
  vi.mocked(projection.project).mockClear()

  emit({ type: 'message_end', message: { role: 'user', content: 'hello', timestamp: 1 } })
  await vi.waitFor(() => expect(projection.project).toHaveBeenCalled())
  unsubscribe()
})

test('forwards thread controls, queue controls, model settings, and host UI responses', async () => {
  const { client, sessionRuntime, agentService } = setup()
  const response = { requestId: 'approval-1', value: 'Allow once' } as const

  await client.getThread('session-1')
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
