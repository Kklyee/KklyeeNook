import { expect, test, vi } from 'vitest'
import type { AgentSessionRecord } from '../db/repositories/agentSessionRepo'
import type { AgentHost } from '../agent/agent-host'
import type { WorkspaceService } from '../workspace/workspaceService'
import type { RemoteEvent } from '@kklyeenook/shared/remote/index'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { ContextAttachmentService } from '../context/contextAttachmentService'
import { emptySnapshot, agentRemoteSnapshot } from '../agent/projection'
import { createRemoteAgentPort } from './remoteAgentPort'

function fixture() {
  const session: AgentSessionRecord = { archived: false, id: 'chat', workspaceId: 'project', title: 'Existing chat', createdAt: 1, updatedAt: 2, permissionMode: 'workspace-write' as const }
  const sessions = new Map<string, AgentSessionRecord & { historical?: boolean }>([['chat', session], ['global', { ...session, id: 'global', workspaceId: null }]])
  const project = { id: 'project', displayName: 'App', rootPath: 'C:\\private-project', status: 'attached', createdAt: 1, updatedAt: 2 }
  const workspaces = { list: vi.fn(async () => [project]), resolve: vi.fn(async () => project) }
  const config = new AgentConfigStore({ model: { provider: 'private-provider', modelID: 'basic', thinkingLevel: 'off' }, providers: [{ id: 'private-provider', baseUrl: 'https://private-provider.test/secret', models: [{ id: 'basic', name: 'Basic', reasoning: false, contextWindow: 128000 }, { id: 'reasoning', name: 'Reasoning', reasoning: true }] }], tools: { enabled: [] } })
  const attachments = new ContextAttachmentService()
  const snapshot = emptySnapshot()
  snapshot.agent = { model: { provider: 'private-provider', modelId: 'basic' }, thinkingLevel: 'off' }
  const inbox = { items: [] as any[] }
  const queue = inbox.items
  const stop = vi.fn(async () => {})
  let listener: ((events: any[]) => Promise<void>) | undefined
  let approvalListener: (() => Promise<void>) | undefined
  const host = {
    models: { contextWindow: vi.fn(() => 128000) },
    conversations: {
      get: vi.fn(async (id: string) => { const value = sessions.get(id); if (!value) throw new Error('Conversation not found'); return value }),
      getLive: vi.fn(async (id: string) => { const value = sessions.get(id); if (!value) throw new Error('Conversation not found'); return value }),
      list: vi.fn(async () => [...sessions.values()]), snapshot: vi.fn(async () => snapshot),
      submit: vi.fn(async (_id: string, _input: any) => ({})), cancel: vi.fn(async () => {}),
      update: vi.fn(async (id: string, patch: any) => Object.assign(sessions.get(id)!, patch)),
    },
    create: vi.fn(async (input: any) => {
      const existing = sessions.get(input.threadId)
      if (existing) return existing
      const value = { ...session, ...input, id: input.threadId }
      sessions.set(value.threadId, value)
      Object.assign(snapshot.agent, { model: input.model, thinkingLevel: input.thinkingLevel })
      return value
    }),
    configure: vi.fn(async (_id: string, patch: any) => Object.assign(snapshot.agent, patch)),
    readHistory: vi.fn(async () => [] as any[]),
    continueHistory: vi.fn(async (id: string, threadId: string) => {
      const value = { ...sessions.get(id)!, id: threadId, historical: false }
      sessions.set(threadId, value)
      return value
    }),
    pendingApprovals: vi.fn(async () => []), decideApproval: vi.fn(async () => {}),
    engine: {
      conversation: vi.fn(async () => ({ id: 1 })),
      harness: { snapshot: vi.fn(async () => inbox), abortSubmission: vi.fn(async () => {}), commit: vi.fn(async (fn: any) => fn({ doc: async () => inbox })), watchDoc: vi.fn(async () => ({ stop: vi.fn(async () => {}), start: (fn: typeof approvalListener) => { approvalListener = fn } })) },
      watch: vi.fn(async () => ({ snapshot, stop, start: (fn: typeof listener) => { listener = fn } })),
    },
  }
  const save = vi.fn()
  const port = createRemoteAgentPort(workspaces as unknown as WorkspaceService, host as unknown as AgentHost, config, save, attachments)
  return { port, host, attachments, workspaces, snapshot, session, sessions, queue, save, stop, emit: (events: any[]) => listener?.(events), emitApproval: () => approvalListener?.() }
}

test('validates uploads before admission and releases staged context after both success and failure', async () => {
  const { port, host, attachments } = fixture()
  const file = { type: 'text' as const, name: 'code.ts', mimeType: 'text/plain', size: 5, text: 'hello' }
  let ids: string[] = []
  host.conversations.submit.mockImplementation(async (_id, input) => { ids = input.contextAttachmentIds; expect(attachments.resolve(ids)[0].text).toBe('hello'); return {} })
  await port.sendMessage('chat', { content: 'Review', mode: 'normal', attachments: [file] })
  expect(() => attachments.resolve(ids)).toThrow('not found')
  host.conversations.submit.mockImplementation(async (_id, input) => { ids = input.contextAttachmentIds; throw new Error('Admission failed') })
  await expect(port.sendMessage('chat', { content: 'Retry', mode: 'followUp', attachments: [file] })).rejects.toThrow('Admission failed')
  expect(() => attachments.resolve(ids)).toThrow('not found')
  await expect(port.sendMessage('chat', { content: 'Big', mode: 'normal', attachments: [{ ...file, size: 512 * 1024 + 1 }] })).rejects.toMatchObject({ status: 400 })
})

test('admits images and delegates busy delivery semantics exclusively to the host', async () => {
  const { port, host } = fixture()
  await port.sendMessage('chat', { content: 'Look', mode: 'steer', attachments: [{ type: 'image', name: 'image.png', mimeType: 'image/png', size: 5, data: 'aGVsbG8=' }] })
  expect(host.conversations.submit).toHaveBeenLastCalledWith('chat', expect.objectContaining({ whenBusy: 'steer', content: [{ type: 'text', text: 'Look' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] }), expect.anything())
  await port.sendMessage('chat', { content: 'Next', mode: 'followUp' })
  expect(host.conversations.submit).toHaveBeenLastCalledWith('chat', expect.objectContaining({ whenBusy: 'followUp' }), expect.anything())
  await port.sendMessage('chat', { content: 'Start', mode: 'normal' })
  expect(host.conversations.submit).toHaveBeenLastCalledWith('chat', expect.objectContaining({ whenBusy: 'reject' }), expect.anything())
  await port.cancel('chat')
  expect(host.conversations.cancel).toHaveBeenCalledWith('chat', expect.anything())
})

test('filters detached projects and global threads and never exposes paths or provider endpoints', async () => {
  const { port, workspaces } = fixture()
  workspaces.list.mockResolvedValue([{ ...await workspaces.resolve(), status: 'detached' }])
  expect(await port.listProjects()).toEqual([])
  await expect(port.getConversation('global')).rejects.toMatchObject({ status: 404 })
  const result = JSON.stringify([await port.getState(), await port.getConversation('chat')])
  expect(result).not.toContain('private-project')
  expect(result).not.toContain('https://private-provider')
  expect((await port.listModels())[0].contextWindow).toBe(128000)
})

test('validates configuration before creating and configures the model before first submission', async () => {
  const { port, host, save } = fixture()
  const input = { permission: 'full-access' as const, provider: 'private-provider', modelId: 'reasoning', thinkingLevel: 'low', prompt: 'Build' }
  await expect(port.createConversation('project', { ...input, thinkingLevel: 'invalid' })).rejects.toMatchObject({ status: 400 })
  expect(host.create).not.toHaveBeenCalled()
  const result = await port.createConversation('project', input)
  expect(result.permission).toBe('full-access')
  expect(host.create).toHaveBeenCalledWith(expect.objectContaining({ model: { provider: input.provider, modelId: input.modelId }, thinkingLevel: input.thinkingLevel }), expect.anything())
  expect(host.configure).not.toHaveBeenCalled()
  expect(save).toHaveBeenCalledWith({ provider: input.provider, modelId: input.modelId, thinkingLevel: input.thinkingLevel })
  await port.setPermission(result.id, 'read-only')
  expect((await port.getConversation(result.id)).permission).toBe('read-only')
})

test('retries remote admissions with the same official identity without reconfiguring an existing conversation', async () => {
  const { port, host, sessions } = fixture()
  const input = { requestId: 'remote-request', permission: 'read-only' as const, provider: 'private-provider', modelId: 'reasoning', thinkingLevel: 'low', prompt: 'Retry me' }
  host.conversations.submit.mockRejectedValueOnce(new Error('Acknowledgement lost'))
  await expect(port.createConversation('project', input)).rejects.toThrow('Acknowledgement lost')
  const created = sessions.get('remote-remote-request')!
  created.permissionMode = 'read-only'
  await port.createConversation('project', { ...input, permission: 'full-access' })
  expect(sessions.size).toBe(3)
  expect(created.permissionMode).toBe('read-only')
  expect(host.configure).not.toHaveBeenCalled()
  for (const call of host.conversations.submit.mock.calls) expect(call).toEqual(['remote-remote-request', expect.objectContaining({ requestId: input.requestId, whenBusy: 'reject' }), expect.anything()])
  await port.sendMessage('chat', { requestId: 'stable-send', content: 'Same message', mode: 'steer' })
  expect(host.conversations.submit).toHaveBeenLastCalledWith('chat', expect.objectContaining({ requestId: 'stable-send' }), expect.anything())
  sessions.set('remote-other-project', { ...created, id: 'remote-other-project', workspaceId: 'another-project' })
  const count = host.conversations.submit.mock.calls.length
  await expect(port.createConversation('project', { ...input, requestId: 'other-project' })).rejects.toMatchObject({ status: 409 })
  expect(host.conversations.submit).toHaveBeenCalledTimes(count)
  await expect(port.sendMessage('chat', { requestId: ' ', content: 'Same message', mode: 'steer' })).rejects.toMatchObject({ status: 400 })
})

test('checks optimistic queue contents and scopes persistent approval decisions', async () => {
  const { port, host, queue } = fixture()
  queue.push({ id: 1, mode: 'followUp', content: 'a' }, { id: 2, mode: 'followUp', content: 'b' })
  await expect(port.updateQueue('chat', { mode: 'followUp', index: 0, expected: ['stale'], action: 'edit', value: 'next' })).rejects.toMatchObject({ status: 409 })
  await port.updateQueue('chat', { mode: 'followUp', index: 0, expected: ['a', 'b'], action: 'edit', value: 'next' })
  expect(queue[0].content).toBe('next')
  await port.clearQueue('chat')
  expect(host.engine.harness.abortSubmission).toHaveBeenCalledTimes(2)
  await port.respondToApproval('approval', { conversationId: 'chat', confirmed: false })
  expect(host.decideApproval).toHaveBeenCalledWith('chat', 'approval', 'rejected', expect.anything())
  await expect(port.respondToApproval('approval', { conversationId: 'chat', value: 'yes' })).rejects.toMatchObject({ status: 400 })
})

test('streams ordered snapshots and unsubscribes without cancelling execution', async () => {
  const { port, host, stop, emit } = fixture()
  const events: RemoteEvent[] = []
  const unsubscribe = port.subscribe('chat', event => events.push(event))
  await vi.waitFor(() => expect(events[0]?.type).toBe('snapshot'))
  await emit([])
  expect(events.map(event => event.seq)).toEqual(events.map((_, index) => index + 1))
  unsubscribe()
  expect(stop).toHaveBeenCalledOnce()
  expect(host.conversations.cancel).not.toHaveBeenCalled()
})

test('moves mixed queue modes without changing other slots and rejects a commit-time race', async () => {
  const { port, host, queue } = fixture()
  queue.push({ id: 1, mode: 'steer', content: 's' }, { id: 2, mode: 'followUp', content: 'a' }, { id: 3, mode: 'steer', content: 't' }, { id: 4, mode: 'followUp', content: 'b' })
  await port.updateQueue('chat', { mode: 'followUp', index: 0, expected: ['a', 'b'], action: 'move', value: 1 })
  expect((await host.engine.harness.snapshot()).items.map((item) => item.content)).toEqual(['s', 'b', 't', 'a'])
  host.engine.harness.commit.mockImplementationOnce(async (fn) => { (await host.engine.harness.snapshot()).items[1].content = 'changed'; return fn({ doc: async () => host.engine.harness.snapshot() }) })
  await expect(port.updateQueue('chat', { mode: 'followUp', index: 0, expected: ['b', 'a'], action: 'edit', value: 'bad' })).rejects.toMatchObject({ status: 409 })
})

test('refreshes persistent approval projections even without a model event', async () => {
  const { port, host, emitApproval } = fixture()
  const events: RemoteEvent[] = []
  const stop = port.subscribe('chat', (event) => events.push(event))
  await vi.waitFor(() => expect(events[0]?.type).toBe('snapshot'))
  host.pendingApprovals.mockResolvedValue([{ id: 'persisted', toolName: 'write', reason: 'Permission required', request: { permission: { toolName: 'write' } } }] as any)
  await emitApproval()
  expect(events).toContainEqual(expect.objectContaining({ type: 'approvals', approvals: [expect.objectContaining({ id: 'persisted' })] }))
  stop()
})

test('reports the last model context budget rather than cumulative billing tokens', async () => {
  const { port, snapshot } = fixture()
  const usage = { input: 100000, output: 5000, cacheRead: 0, cacheWrite: 0, totalTokens: 105000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  snapshot.usage.models = { 'private-provider/basic': { ...usage, totalTokens: 500000 } }
  snapshot.entries = [{ id: 1, conversationId: 1, kind: 'pi.assistant', model: [{ role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'Reply' }], usage }] }] as any
  expect((await port.getConversation('chat')).contextBudget).toMatchObject({ tokens: 105000, contextWindow: 128000, usedPercent: 105000 / 128000, state: 'critical' })
})

test('strips opaque model signatures and tool details from public transcript projection', () => {
  const { snapshot, session } = fixture()
  snapshot.entries = [{ id: 1, conversationId: 1, kind: 'pi.assistant', model: [{ role: 'assistant', timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, content: [{ type: 'text', text: 'Reply', textSignature: 'opaque-secret' }, { type: 'thinking', thinking: 'Thinking', thinkingSignature: 'opaque-secret' }, { type: 'toolCall', id: 'tool', name: 'bash', arguments: { internal: 'hidden' } }] }] }] as any
  const result = agentRemoteSnapshot({ snapshot, metadata: session, queue: [], approvals: [], permission: 'workspace-write' })
  expect(JSON.stringify(result)).not.toContain('opaque-secret')
  expect(JSON.stringify(result)).not.toContain('hidden')
})

test('keeps historical conversations visible, inert and explicitly continued with their workspace and permission', async () => {
  const { port, host, sessions, session } = fixture()
  sessions.set('legacy', { ...session, id: 'legacy', historical: true, permissionMode: 'read-only' })
  host.readHistory.mockResolvedValue([{ id: 'old', kind: 'message', role: 'assistant', createdAt: 1, source: { sessionFile: 'C:\\private-session' }, payload: { message: { role: 'assistant', content: [{ type: 'text', text: 'Historical answer' }, { type: 'toolCall', id: 'old-tool', name: 'write', arguments: { secret: 'hidden-argument' } }] } } }])
  expect((await port.listProjects())[0].conversationCount).toBe(2)
  expect(await port.listConversations('project')).toContainEqual(expect.objectContaining({ id: 'legacy', historical: true, status: 'idle' }))
  const old = await port.getConversation('legacy')
  expect(old).toMatchObject({ historical: true, permission: 'read-only', queue: [], approvals: [] })
  expect(JSON.stringify(old)).toContain('Historical answer')
  expect(JSON.stringify(old)).not.toContain('private-session')
  expect(JSON.stringify(old)).not.toContain('hidden-argument')
  await expect(port.sendMessage('legacy', { content: 'Do not replay', mode: 'normal' })).rejects.toMatchObject({ status: 409 })
  await expect(port.setPermission('legacy', 'full-access')).rejects.toMatchObject({ status: 409 })
  expect(host.conversations.submit).not.toHaveBeenCalled()
  const events: RemoteEvent[] = []
  const stop = port.subscribe('legacy', event => events.push(event))
  await vi.waitFor(() => expect(events[0]?.type).toBe('snapshot'))
  expect(host.engine.watch).not.toHaveBeenCalled()
  stop()
  await port.renameConversation('legacy', 'Renamed history')
  const continued = await port.continueConversation('legacy', 'continued')
  expect(host.continueHistory).toHaveBeenCalledWith('legacy', 'continued', expect.anything())
  expect(continued).toMatchObject({ id: 'continued', projectId: 'project', permission: 'read-only' })
  expect(host.conversations.submit).not.toHaveBeenCalled()
})

test('refuses historical continuation into a detached workspace', async () => {
  const { port, host, sessions, session, workspaces } = fixture()
  sessions.set('legacy', { ...session, id: 'legacy', historical: true })
  workspaces.resolve.mockResolvedValue({ ...await workspaces.resolve(), status: 'detached' })
  expect((await port.getConversation('legacy')).permission).toBe('read-only')
  await expect(port.continueConversation('legacy', 'continued')).rejects.toMatchObject({ status: 409 })
  expect(host.continueHistory).not.toHaveBeenCalled()
})

test('preserves completed tool and thinking activity at desktop text boundaries on reopening', async () => {
  const { port, snapshot } = fixture()
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  snapshot.entries = [
    { id: 1, model: [{ role: 'user', content: 'Question', timestamp: 1 }] },
    { id: 2, model: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'Plan' }, { type: 'text', text: 'Before' }, { type: 'toolCall', id: 'read', name: 'read', arguments: { private: 'hidden' } }], timestamp: 2, usage }] },
    { id: 3, model: [{ role: 'toolResult', toolCallId: 'read', toolName: 'read', content: [{ type: 'text', text: 'output' }], isError: false, timestamp: 3, details: { secret: 'hidden' } }] },
    { id: 4, model: [{ role: 'assistant', content: [{ type: 'text', text: 'After' }], timestamp: 4, usage }] },
  ] as any
  const first = await port.getConversation('chat')
  expect(first.activities).toEqual([
    expect.objectContaining({ type: 'thinking', status: 'completed', textOffset: 0, detail: 'Plan' }),
    expect.objectContaining({ toolCallId: 'read', status: 'completed', textOffset: 6 }),
  ])
  expect(JSON.stringify(first.activities)).not.toContain('hidden')
  expect((await port.getConversation('chat')).activities).toEqual(first.activities)
})

test('counts actual active conversations and rejects invalid queue mode changes and destinations', async () => {
  const { port, snapshot, queue } = fixture()
  snapshot.run = { inputs: [1 as never] }
  expect((await port.listProjects())[0].activeRunCount).toBe(1)
  queue.push({ id: 1, mode: 'steer', content: 's' })
  await expect(port.updateQueue('chat', { mode: 'steer', expected: ['s'], index: 0, action: 'steer' })).rejects.toMatchObject({ status: 400 })
  await expect(port.updateQueue('chat', { mode: 'steer', expected: ['s'], index: 0, action: 'move', value: 1 })).rejects.toMatchObject({ status: 400 })
  await expect(port.updateQueue('chat', { mode: 'steer', expected: ['s'], index: -1, action: 'remove' })).rejects.toMatchObject({ status: 400 })
})

test('stops watches when the initial snapshot fails and suppresses delivery after unsubscribe races', async () => {
  const { port, host, stop, emit } = fixture()
  const events: RemoteEvent[] = []
  host.conversations.snapshot.mockRejectedValueOnce(new Error('C:\\private-failure'))
  const unsubscribe = port.subscribe('chat', event => events.push(event))
  await vi.waitFor(() => expect(events[0]?.type).toBe('error'))
  expect(stop).toHaveBeenCalledOnce()
  expect(JSON.stringify(events)).not.toContain('private-failure')
  unsubscribe()
  const previous = events.length
  await emit([])
  expect(events).toHaveLength(previous)
  const cancel = port.subscribe('chat', event => events.push(event))
  cancel()
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(3))
  expect(events).toHaveLength(previous)
})
