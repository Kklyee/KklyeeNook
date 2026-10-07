import { expect, test, vi } from 'vitest'
import type { PiClientEvent, PiThreadSnapshot } from '@assistant-ui/react-pi'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { AgentEventEnvelope } from '@/shared/agent/agentExecutionRecord'
import type { RemoteEvent } from '@kklyeenook/shared/remote/index'
import type { AgentService } from '../agent/agentService'
import type { WorkspaceService } from '../workspace/workspaceService'
import type { PiClientService } from '../agent/pi/client/piClientService'
import type { PiSessionRuntimeManager } from '../agent/pi/runtime/piSessionRuntimeManager'
import type { ExecutionContextService } from '../workspace/executionContextService'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { updateAgentModelSelectionFromCatalog } from '../settings/modelCatalog'
import { createRemoteAgentPort } from './remoteAgentPort'
import { remoteSnapshot } from './remoteState'

function fixture() {
  const order: string[] = []
  const session: AgentSessionSummary = { id: 'chat', workspaceId: 'project', title: 'Existing chat', createdAt: 1, updatedAt: 2, permissionMode: 'workspace-write' }
  const sessions = new Map([['chat', session], ['other', { ...session, id: 'other', workspaceId: 'other-project' }], ['global', { ...session, id: 'global', workspaceId: null }]])
  const project = { id: 'project', displayName: 'App', rootPath: 'C:\\private-project', status: 'attached' as const, createdAt: 1, updatedAt: 2 }
  const workspaces = { list: vi.fn(async () => [project]), resolve: vi.fn(async () => project) }
  const agents = {
    getSession: vi.fn((id: string) => sessions.has(id) ? { toSummary: () => sessions.get(id)! } : undefined),
    listSessions: vi.fn(async () => [...sessions.values()]),
    createSession: vi.fn(async (_title: unknown, workspaceId: string) => { order.push('create'); const created = { ...session, id: 'new', workspaceId }; sessions.set('new', created); return created }),
    setPermissionMode: vi.fn(async (id: string, mode: AgentSessionSummary['permissionMode']) => { order.push('permission'); sessions.get(id)!.permissionMode = mode }),
    listRuns: vi.fn(async () => []),
    listExecutionRecords: vi.fn(async () => []),
    subscribe: vi.fn((_listener: (event: AgentEventEnvelope) => void) => vi.fn()),
  }
  const config = new AgentConfigStore({
    model: { provider: 'private-provider', modelID: 'model-1', thinkingLevel: 'off', baseUrl: 'https://private-provider.test/secret' },
    providers: [{ id: 'private-provider', baseUrl: 'https://private-provider.test/secret', models: [{ id: 'model-1', name: 'Basic', reasoning: false }, { id: 'model-2', name: 'Reasoning', reasoning: true }] }],
    tools: { enabled: [] },
  })
  let piListener: ((event: PiClientEvent) => void) | undefined
  const piUnsubscribe = vi.fn()
  const snapshot = (id = 'chat'): PiThreadSnapshot => ({
    metadata: { id, title: sessions.get(id)?.title, status: sessions.get(id)?.activeRunId ? 'running' : 'idle', sessionFile: 'C:\\private-sessions\\session.jsonl', workspacePath: project.rootPath, config: { provider: config.get().model.provider, modelId: config.get().model.modelID, thinkingLevel: config.get().model.thinkingLevel } },
    messages: [{ role: 'user', timestamp: 1, content: 'Hello' }],
    hostUiRequests: [{ id: 'approval', kind: 'confirm', title: 'Permission', message: 'Run tool?' }],
  })
  const pi = {
    getThread: vi.fn(async (id: string) => snapshot(id)),
    setModel: vi.fn(async () => { order.push('model') }),
    setThinkingLevel: vi.fn(async () => { order.push('thinking') }),
    sendMessage: vi.fn(async () => { order.push('send') }),
    renameThread: vi.fn(async () => {}),
    cancelRun: vi.fn(async () => {}),
    clearQueue: vi.fn(async () => ({ steering: [], followUp: [] })),
    updateQueuedMessage: vi.fn(async () => ({ steering: [], followUp: [] })),
    respondToHostUiRequest: vi.fn(async () => {}),
    subscribe: vi.fn((id: string, listener: (event: PiClientEvent) => void) => { piListener = listener; listener({ type: 'snapshot', threadId: id, seq: 1, snapshot: snapshot(id) }); return piUnsubscribe }),
  }
  const runtime = { isRunning: vi.fn(() => false), reloadConfiguration: vi.fn() }
  const contexts = { resolve: vi.fn(async () => ({ conversationId: 'chat', workspace: { id: project.id, rootPath: project.rootPath } })) }
  const saveModelSelection = vi.fn(selection => {
    config.set(updateAgentModelSelectionFromCatalog(config.get(), { provider: selection.provider, modelID: selection.modelId, thinkingLevel: selection.thinkingLevel }))
  })
  const port = createRemoteAgentPort(workspaces as unknown as WorkspaceService, agents as unknown as AgentService, pi as unknown as PiClientService, { get: () => runtime } as unknown as PiSessionRuntimeManager, contexts as unknown as ExecutionContextService, config, saveModelSelection)
  return { port, pi, agents, sessions, session, project, config, order, runtime, saveModelSelection, piUnsubscribe, snapshot, emit: (event: PiClientEvent) => piListener?.(event) }
}

test('maps existing Workspaces to Projects, filters conversations and excludes paths and provider secrets', async () => {
  const { port } = fixture()
  expect(await port.listProjects()).toEqual([{ id: 'project', name: 'App', conversationCount: 1, activeRunCount: 0, updatedAt: 2 }])
  expect((await port.listConversations('project')).map(item => item.id)).toEqual(['chat'])
  const data = JSON.stringify([await port.getState(), await port.getConversation('chat')])
  expect(data).not.toContain('private-sessions')
  expect(data).not.toContain('private-project')
  expect(data).not.toContain('https://private-provider')
  expect((await port.listModels()).map(model => model.name)).toEqual(['Basic', 'Reasoning'])
  await expect(port.getConversation('global')).rejects.toMatchObject({ status: 404 })
})

test('validates creation before creating a session and applies permission, model and thinking before the prompt', async () => {
  const { port, order, agents, pi, saveModelSelection } = fixture()
  const input = { permission: 'full-access' as const, provider: 'private-provider', modelId: 'model-2', thinkingLevel: 'low', prompt: 'Build a feature' }
  await expect(port.createConversation('project', { ...input, thinkingLevel: 'impossible' })).rejects.toMatchObject({ status: 400 })
  expect(agents.createSession).not.toHaveBeenCalled()
  const result = await port.createConversation('project', input)
  expect(order).toEqual(['create', 'permission', 'model', 'thinking', 'send'])
  expect(agents.createSession).toHaveBeenCalledWith(undefined, 'project')
  expect(pi.sendMessage).toHaveBeenCalledWith('new', { content: input.prompt })
  expect(saveModelSelection).toHaveBeenCalledWith({ provider: input.provider, modelId: input.modelId, thinkingLevel: input.thinkingLevel })
  expect(result.permission).toBe('full-access')
  expect(result.model?.modelId).toBe('model-2')
})

test('controls the same Pi session, rejects normal send during runs and preserves native follow-up and steer semantics', async () => {
  const { port, pi, session } = fixture()
  await port.sendMessage('chat', { content: 'Start', mode: 'normal' })
  expect(pi.sendMessage).toHaveBeenCalledWith('chat', { content: 'Start', streamingBehavior: undefined })
  session.activeRunId = 'run'
  await expect(port.sendMessage('chat', { content: 'next', mode: 'normal' })).rejects.toMatchObject({ status: 409 })
  await port.sendMessage('chat', { content: 'Next task', mode: 'followUp' })
  await port.sendMessage('chat', { content: 'Change course', mode: 'steer' })
  expect(pi.sendMessage).toHaveBeenCalledWith('chat', { content: 'Next task', streamingBehavior: 'followUp' })
  expect(pi.sendMessage).toHaveBeenCalledWith('chat', { content: 'Change course', streamingBehavior: 'steer' })
  await expect(port.setPermission('chat', 'full-access')).rejects.toMatchObject({ status: 409 })
  await port.cancel('chat')
  expect(pi.cancelRun).toHaveBeenCalledWith('chat')
})

test('uses Desktop model selection persistence and normal permission reload behavior', async () => {
  const { port, pi, runtime, saveModelSelection, config } = fixture()
  await port.setModel('chat', { provider: 'private-provider', modelId: 'model-2' })
  await port.setThinkingLevel('chat', 'high')
  expect(saveModelSelection).toHaveBeenLastCalledWith({ provider: 'private-provider', modelId: 'model-2', thinkingLevel: 'high' })
  expect(config.get().model.thinkingLevel).toBe('high')
  await port.setPermission('chat', 'read-only')
  expect(runtime.reloadConfiguration).toHaveBeenCalledOnce()
  expect((await port.getConversation('chat')).permission).toBe('read-only')
  await expect(port.setModel('chat', { provider: 'unknown', modelId: 'secret' })).rejects.toMatchObject({ status: 400 })
  expect(pi.setModel).toHaveBeenCalledTimes(1)
})

test('forwards native optimistic queue mutations and scopes pending approval responses to their conversation', async () => {
  const { port, pi } = fixture()
  const mutation = { mode: 'followUp' as const, index: 1, expected: ['a', 'b'], action: 'edit' as const, value: 'next' }
  await port.updateQueue('chat', mutation)
  expect(pi.updateQueuedMessage).toHaveBeenCalledWith('chat', mutation)
  await port.clearQueue('chat')
  expect(pi.clearQueue).toHaveBeenCalledWith('chat')
  await port.respondToApproval('approval', { conversationId: 'chat', confirmed: false })
  expect(pi.respondToHostUiRequest).toHaveBeenCalledWith('chat', { requestId: 'approval', confirmed: false })
  await expect(port.respondToApproval('missing', { conversationId: 'chat', confirmed: true })).rejects.toMatchObject({ status: 409 })
  await expect(port.respondToApproval('approval', { conversationId: 'chat', value: 'yes' })).rejects.toMatchObject({ status: 400 })
})

test('streams snapshot before buffered deltas, queue, approval and status events and detaches without stopping the Agent', async () => {
  const { port, emit, pi, piUnsubscribe } = fixture()
  const events: RemoteEvent[] = []
  const unsubscribe = port.subscribe('chat', event => events.push(event))
  emit({ type: 'message_update', threadId: 'chat', seq: 2, message: { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'Partial reply' }] } as never, assistantMessageEvent: {} as never })
  emit({ type: 'queue_update', threadId: 'chat', seq: 3, steering: ['adjust'], followUp: ['next'] })
  emit({ type: 'extension_ui_resolved', threadId: 'chat', seq: 4, requestId: 'approval' })
  emit({ type: 'agent_start', threadId: 'chat', seq: 5 })
  await vi.waitFor(() => expect(events).toHaveLength(5))
  expect(events.map(event => event.type)).toEqual(['snapshot', 'message', 'queue', 'approvals', 'status'])
  expect(events.map(event => event.seq)).toEqual([1, 2, 3, 4, 5])
  expect(events[1]).toMatchObject({ message: { status: 'running', content: [{ type: 'text', text: 'Partial reply' }] } })
  unsubscribe()
  expect(piUnsubscribe).toHaveBeenCalledOnce()
  expect(pi.cancelRun).not.toHaveBeenCalled()
})

test('projects transcript content without signatures, session files, tool arguments or raw Pi details', () => {
  const { snapshot } = fixture()
  const input = snapshot()
  input.messages.push({ role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'Reply', textSignature: 'opaque-secret' }, { type: 'thinking', thinking: 'Thinking', thinkingSignature: 'opaque-secret' }, { type: 'toolCall', id: 'tool', name: 'bash', arguments: { internal: 'hidden' } }] } as never)
  input.messages.push({ role: 'toolResult', timestamp: 3, content: [{ type: 'text', text: 'output' }], details: { internal: 'hidden' } } as never)
  const result = remoteSnapshot(input, { id: 'chat', title: 'Chat', projectId: 'project', status: 'idle', updatedAt: 2 }, 'workspace-write')
  expect(result.messages).toHaveLength(2)
  expect(JSON.stringify(result)).not.toContain('opaque-secret')
  expect(JSON.stringify(result)).not.toContain('hidden')
  expect(JSON.stringify(result)).not.toContain('session.jsonl')
})
