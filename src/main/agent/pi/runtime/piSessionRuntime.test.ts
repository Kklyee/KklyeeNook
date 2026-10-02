import { expect, test, vi } from 'vitest'
import { Agent } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, Type, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import type { ExecutionBoundaryEvent } from '@/main/agent/agentRuntime'
import { PiAgentRuntime } from './piAgentRuntime'

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'
import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { AgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import type { CredentialStore } from '@/main/settings/credentialStore'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import { normalizePiSkillCommand, PiSessionRuntime } from './piSessionRuntime'

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: class {
    async reload() {}
  },
  ModelRuntime: { create: vi.fn() },
  SessionManager: { create: vi.fn() },
  SettingsManager: {
    create: vi.fn(() => ({ applyOverrides: vi.fn() })),
  },
}))

function fakeSession() {
  let sessionListener: ((event: AgentSessionEvent) => void) | undefined
  return {
    sessionId: 'session-1',
    sessionFile: 'session.jsonl',
    systemPrompt: 'system',
    messages: [],
    model: { provider: 'custom', id: 'model-1' },
    thinkingLevel: 'off',
    state: { pendingToolCalls: new Map() },
    isStreaming: false,
    isCompacting: false,
    isRetrying: false,
    getContextUsage: vi.fn(),
    getSteeringMessages: vi.fn(() => []),
    getFollowUpMessages: vi.fn(() => []),
    bindExtensions: vi.fn(),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      sessionListener = listener
      return vi.fn()
    }),
    emit(event: AgentSessionEvent) {
      sessionListener?.(event)
    },
    prompt: vi.fn(),
    abort: vi.fn(),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    setSteeringMode: vi.fn(),
    setFollowUpMode: vi.fn(),
    steer: vi.fn(),
    followUp: vi.fn(),
    agent: {
      state: { tools: [] },
      streamFunction: vi.fn(),
      transformContext: undefined as Agent['transformContext'],
      subscribe: vi.fn(() => () => undefined),
      steer: vi.fn(),
      followUp: vi.fn(),
    },
    dispose: vi.fn(),
  }
}

test('supports short skill slash commands', () => {
  const skills = [{ name: 'code-review', baseDir: 'C:\\skills\\code-review' }]

  expect(normalizePiSkillCommand('/code-review inspect files', skills)).toBe(
    '/skill:code-review inspect files',
  )
  expect(normalizePiSkillCommand('/skill:code-review inspect files', skills)).toBe(
    '/skill:code-review inspect files',
  )
  expect(normalizePiSkillCommand('/unknown inspect files', skills)).toBe('/unknown inspect files')
})

function fakeSessionManager(
  context: {
    messages: never[]
    thinkingLevel: string
    model: { provider: string; modelId: string } | null
  } = { messages: [], thinkingLevel: 'off', model: null },
  branch: Array<{ type: string }> = [],
) {
  return { buildSessionContext: vi.fn(() => context), getBranch: vi.fn(() => branch) }
}

test.each([
  undefined,
  { tokens: null, contextWindow: 128_000, percent: null },
])('does not invent usage at step and compaction boundaries: %j', async (postUsage) => {
  const session = fakeSession()
  vi.mocked(createAgentSession).mockResolvedValue({ session } as never)
  vi.mocked(SessionManager.create).mockReturnValue(fakeSessionManager() as never)
  vi.mocked(ModelRuntime.create).mockResolvedValue({
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), setRuntimeApiKey: vi.fn(),
    getModel: () => ({ provider: 'custom', id: 'model-1' }),
  } as never)
  const runtime = new PiSessionRuntime(
    'session-1',
    new AgentConfigStore({ model: { provider: 'custom', modelID: 'model-1', baseUrl: 'https://example.test', thinkingLevel: 'off' }, tools: { enabled: [] } }),
    { getApiKey: () => 'secret' } as unknown as CredentialStore,
    { findBySessionId: vi.fn(), save: vi.fn() } as unknown as AgentRuntimeStateRepo,
    new ToolRegistry(), 'sessions',
  )
  const events: AgentEvent[] = []
  runtime.subscribeProductEvents((event) => events.push(event))
  await runtime.initialize()
  session.getContextUsage.mockReturnValue(undefined)
  session.emit({ type: 'turn_end', message: { role: 'assistant', stopReason: 'stop' }, toolResults: [] } as never)
  expect(events).toEqual([])
  session.getContextUsage.mockReturnValue({ tokens: 126_000, contextWindow: 128_000, percent: 98.4375 })
  session.emit({ type: 'compaction_start', reason: 'overflow' })
  session.getContextUsage.mockReturnValue(postUsage)
  session.emit({
    type: 'compaction_end', reason: 'overflow', aborted: false, willRetry: false,
    result: { summary: 'private', firstKeptEntryId: 'entry-1', tokensBefore: 126_000, estimatedTokensAfter: 24_000 },
  })
  const usageEvents = events.filter((event) => event.type === 'context_usage_updated')
  expect(usageEvents).toEqual(postUsage ? [{ type: 'context_usage_updated', source: 'compaction', usage: { contextWindow: 128_000 } }] : [])
  const eventCount = events.length
  session.emit({ type: 'agent_end', messages: [], willRetry: false })
  expect(events).toHaveLength(eventCount)
  session.getContextUsage.mockReturnValue({ tokens: 126_000, contextWindow: 128_000, percent: 98.4375 })
  session.emit({ type: 'compaction_start', reason: 'overflow' })
  session.getContextUsage.mockReturnValue(undefined)
  session.emit({ type: 'compaction_end', reason: 'overflow', result: undefined, aborted: false, willRetry: false, errorMessage: 'provider error' })
  expect(events.at(-1)).toEqual({
    type: 'context_compaction_failed', reason: 'overflow', tokensBefore: 126_000, contextWindow: 128_000, error: 'provider error',
  })
  expect(events.filter((event) => event.type === 'context_usage_updated')).toEqual(usageEvents)
  runtime.dispose()
})

test('uses configured custom-provider limits and keeps client subscriptions across reloads', async () => {
  const model = { provider: 'custom', id: 'model-1' }
  let registered = false
  const runtime = {
    registerProvider: vi.fn(() => {
      registered = true
    }),
    unregisterProvider: vi.fn(() => {
      registered = false
    }),
    setRuntimeApiKey: vi.fn(),
    getModel: vi.fn(() => (registered ? model : undefined)),
  }
  vi.mocked(ModelRuntime.create).mockResolvedValue(runtime as never)
  vi.mocked(SessionManager.create).mockReturnValue(fakeSessionManager() as never)
  const firstSession = fakeSession()
  const secondSession = fakeSession()
  vi.mocked(createAgentSession)
    .mockResolvedValueOnce({ session: firstSession } as never)
    .mockResolvedValueOnce({ session: secondSession } as never)

  const configStore = new AgentConfigStore({
    model: {
      provider: 'custom',
      providerName: 'Custom Provider',
      modelID: 'model-1',
      baseUrl: 'https://example.test/v1',
      contextWindow: 32_000,
      maxTokens: 4_000,
      thinkingLevel: 'off',
    },
    tools: { enabled: [] },
    cwd: 'C:\\workspace',
    compaction: { enabled: false, reserveTokens: 2_048, keepRecentTokens: 4_096 },
  })
  const toolRegistry = new ToolRegistry()
  toolRegistry.register({
    definition: {
      name: 'mcp__filesystem__search',
      label: 'Filesystem: search',
      description: 'Search files',
      inputSchema: { type: 'object' },
      origin: {
        kind: 'mcp',
        serverId: 'filesystem',
        serverName: 'Filesystem',
        remoteName: 'search',
      },
    },
    adapter: { runtime: 'pi', create: () => ({ name: 'mcp__filesystem__search' }) },
  })
  const settingsManager = { applyOverrides: vi.fn() }
  vi.mocked(SettingsManager.create).mockReturnValue(settingsManager as never)
  const sessionRuntime = new PiSessionRuntime(
    'session-1',
    configStore,
    { getApiKey: () => 'secret' } as unknown as CredentialStore,
    { findBySessionId: vi.fn(), save: vi.fn() } as unknown as AgentRuntimeStateRepo,
    toolRegistry,
    'sessions',
  )
  const events: string[] = []
  const productEvents: AgentEvent[] = []
  sessionRuntime.subscribeClientEvents((event) => events.push(event.type))
  sessionRuntime.subscribeProductEvents((event) => productEvents.push(event))

  await sessionRuntime.initialize()
  expect(vi.mocked(createAgentSession).mock.calls.at(-1)?.[0]?.cwd).not.toBe('C:\\workspace')
  expect(vi.mocked(createAgentSession).mock.calls.at(-1)?.[0]?.tools).toEqual([
    'mcp__filesystem__search',
  ])
  expect(configStore.get().tools.enabled).toEqual([])
  expect(settingsManager.applyOverrides).toHaveBeenCalledWith({
    compaction: { enabled: false, reserveTokens: 2_048, keepRecentTokens: 4_096 },
  })
  firstSession.getContextUsage.mockReturnValue({
    tokens: 42_000,
    contextWindow: 128_000,
    percent: 32.8125,
  })
  expect(sessionRuntime.getContextUsage()).toEqual({
    tokens: 42_000,
    contextWindow: 128_000,
    percent: 32.8125,
  })
  firstSession.getContextUsage.mockReturnValue({ tokens: 112_000, contextWindow: 128_000, percent: 87.5 })
  firstSession.emit({ type: 'compaction_start', reason: 'threshold' })
  firstSession.getContextUsage.mockReturnValue({ tokens: 37_000, contextWindow: 128_000, percent: 28.90625 })
  firstSession.emit({
    type: 'compaction_end',
    reason: 'threshold',
    result: {
      summary: 'private summary',
      firstKeptEntryId: 'entry-1',
      tokensBefore: 112_000,
      estimatedTokensAfter: 36_000,
    },
    aborted: false,
    willRetry: false,
  })
  expect(productEvents).toEqual([
    { type: 'context_compaction_started', reason: 'threshold', tokensBefore: 112_000, contextWindow: 128_000 },
    {
      type: 'context_compaction_completed',
      reason: 'threshold',
      tokensBefore: 112_000,
      estimatedTokensAfter: 36_000,
      contextWindow: 128_000,
    },
    { type: 'context_usage_updated', source: 'compaction', usage: { tokens: 37_000, contextWindow: 128_000, percent: 28.90625 } },
  ])
  expect(runtime.registerProvider).toHaveBeenCalledWith(
    'custom',
    expect.objectContaining({
      name: 'Custom Provider',
      models: [expect.objectContaining({ contextWindow: 32_000, maxTokens: 4_000 })],
    }),
  )

  toolRegistry.register({
    definition: {
      name: 'mcp__github__search',
      label: 'GitHub: search',
      description: 'Search repositories',
      inputSchema: { type: 'object' },
      origin: {
        kind: 'mcp',
        serverId: 'github',
        serverName: 'GitHub',
        remoteName: 'search',
      },
    },
    adapter: { runtime: 'pi', create: () => ({ name: 'mcp__github__search' }) },
  })
  await sessionRuntime.initialize()
  expect(firstSession.dispose).toHaveBeenCalledOnce()
  expect(vi.mocked(createAgentSession).mock.calls.at(-1)?.[0]?.tools).toEqual([
    'mcp__filesystem__search',
    'mcp__github__search',
  ])
  secondSession.emit({ type: 'agent_start' })
  expect(events).toContain('agent_start')
})

test('enables image input for the current DeepSeek Flash alias', async () => {
  const model = {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    api: 'openai-completions',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    reasoning: true,
    input: ['text'] as const,
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  }
  const runtime = {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    setRuntimeApiKey: vi.fn(),
    getModel: vi.fn(() => model),
    getModels: vi.fn(() => [model]),
  }
  vi.mocked(ModelRuntime.create).mockResolvedValue(runtime as never)
  vi.mocked(SessionManager.create).mockReturnValue(fakeSessionManager() as never)
  vi.mocked(createAgentSession).mockResolvedValue({ session: fakeSession() } as never)

  const sessionRuntime = new PiSessionRuntime(
    'session-1',
    new AgentConfigStore({
      model: { provider: 'deepseek', modelID: 'deepseek-v4-flash', thinkingLevel: 'off' },
      tools: { enabled: [] },
      cwd: 'C:\\workspace',
    }),
    { getApiKey: () => 'secret' } as unknown as CredentialStore,
    { findBySessionId: vi.fn(), save: vi.fn() } as unknown as AgentRuntimeStateRepo,
    new ToolRegistry(),
    'sessions',
  )

  await sessionRuntime.initialize()

  expect(runtime.registerProvider).toHaveBeenCalledWith(
    'deepseek',
    expect.objectContaining({
      models: [expect.objectContaining({ reasoning: true, input: ['text', 'image'] })],
    }),
  )
})

test('uses the configured model and thinking level instead of the Pi session transcript', async () => {
  const restoredModel = { provider: 'deepseek', modelId: 'deepseek-v4-pro' }
  const runtime = {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    setRuntimeApiKey: vi.fn(),
    getModel: vi.fn((_provider: string, modelId: string) => ({
      provider: 'deepseek',
      id: modelId,
      input: ['text'],
      contextWindow: 128_000,
      maxTokens: 16_384,
    })),
    getModels: vi.fn(() => []),
  }
  const sessionManager = fakeSessionManager(
    { messages: [], thinkingLevel: 'max', model: restoredModel },
    [{ type: 'thinking_level_change' }],
  )
  vi.mocked(ModelRuntime.create).mockResolvedValue(runtime as never)
  vi.mocked(SessionManager.create).mockReturnValue(sessionManager as never)
  vi.mocked(createAgentSession).mockResolvedValue({ session: fakeSession() } as never)

  const sessionRuntime = new PiSessionRuntime(
    'session-1',
    new AgentConfigStore({
      model: { provider: 'deepseek', modelID: 'deepseek-v4-flash', thinkingLevel: 'off' },
      providers: [{ id: 'deepseek' }],
      tools: { enabled: [] },
      cwd: 'C:\\workspace',
    }),
    { getApiKey: () => 'secret' } as unknown as CredentialStore,
    { findBySessionId: vi.fn(), save: vi.fn() } as unknown as AgentRuntimeStateRepo,
    new ToolRegistry(),
    'sessions',
  )

  await sessionRuntime.initialize()

  const options = vi.mocked(createAgentSession).mock.calls.at(-1)?.[0]
  expect(options).toEqual(
    expect.objectContaining({
      model: expect.objectContaining({ provider: 'deepseek', id: 'deepseek-v4-flash' }),
      thinkingLevel: 'off',
      sessionManager,
    }),
  )
})

test('maps real Pi turns, batched duplicate steering and follow-up to execution boundaries', async () => {
  const model: Model<'openai-completions'> = {
    id: 'model-1', name: 'Test model', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.test',
    reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 4000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  let requests = 0
  let releaseFirstRequest: () => void = () => undefined
  const agent = new Agent({
    initialState: {
      model,
      tools: [{
        name: 'test_tool', label: 'test', description: 'Test', parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
      }],
    },
    streamFn: () => {
      const request = ++requests
      const stream = createAssistantMessageEventStream()
      const finish = () => {
        const message: AssistantMessage = {
          role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
          content: request === 1
            ? [0, 1, 2].map((index) => ({ type: 'toolCall', id: `read-${index}`, name: 'test_tool', arguments: {} }))
            : [{ type: 'text', text: 'done' }],
          stopReason: request === 1 ? 'toolUse' : 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        }
        stream.push({ type: 'start', partial: message })
        stream.push({ type: 'done', reason: request === 1 ? 'toolUse' : 'stop', message })
      }
      if (request === 1) releaseFirstRequest = finish
      else finish()
      return stream
    },
  })
  const session = { ...fakeSession(), agent, get isStreaming() { return agent.state.isStreaming } }
  agent.subscribe((event) => session.emit(event.type === 'agent_end' ? { ...event, willRetry: false } : event))
  session.setSteeringMode.mockImplementation((mode) => { agent.steeringMode = mode })
  session.setFollowUpMode.mockImplementation((mode) => { agent.followUpMode = mode })
  session.prompt.mockImplementation(async (text: string) => {
    await agent.prompt(text)
    session.emit({ type: 'agent_settled' })
  })
  session.steer.mockImplementation(async (text: string) => agent.steer({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() }))
  session.followUp.mockImplementation(async (text: string) => agent.followUp({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() }))
  session.clearQueue.mockImplementation(() => {
    agent.clearAllQueues()
    return { steering: [], followUp: [] }
  })
  vi.mocked(createAgentSession).mockResolvedValue({ session } as never)
  vi.mocked(SessionManager.create).mockReturnValue(fakeSessionManager() as never)
  vi.mocked(ModelRuntime.create).mockResolvedValue({
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), setRuntimeApiKey: vi.fn(),
    getModel: () => model, getModels: () => [],
  } as never)
  const toolRegistry = new ToolRegistry()
  const tool = agent.state.tools[0]
  toolRegistry.register({
    definition: { name: tool.name, label: tool.label, description: tool.description, inputSchema: tool.parameters },
    adapter: { runtime: 'pi', create: () => tool },
  })
  const sessionRuntime = new PiSessionRuntime(
    'session-1',
    new AgentConfigStore({ model: { provider: 'custom', modelID: 'model-1', baseUrl: 'https://example.test', thinkingLevel: 'off' }, tools: { enabled: [] } }),
    { getApiKey: () => 'secret' } as unknown as CredentialStore,
    { findBySessionId: vi.fn(), save: vi.fn() } as unknown as AgentRuntimeStateRepo,
    toolRegistry, 'sessions',
  )
  const boundaries: ExecutionBoundaryEvent[] = []
  const toolEvents: AgentEvent[] = []
  const runtimeEvents: import('@/main/agent/agentRuntime').AgentRuntimeEvent[] = []
  session.getContextUsage.mockReturnValue({ tokens: 31_000, contextWindow: 128_000, percent: 24.21875 })
  const runtime = new PiAgentRuntime(sessionRuntime, () => sessionRuntime.dispose())
  const completion = runtime.run({ prompt: 'same', runId: 'run-1' }, (event) => {
    runtimeEvents.push(event)
    if (event.type === 'pi_turn_start' || event.type === 'pi_turn_end' || event.type === 'pi_agent_settled') boundaries.push(event)
    else toolEvents.push(event)
  })
  await vi.waitFor(() => {
    expect(toolEvents.filter((event) => event.type === 'agent_failed')).toEqual([])
    expect(requests).toBe(1)
  })
  await Promise.all([0, 1, 2].map(() => sessionRuntime.sendMessage({ content: 'same', streamingBehavior: 'steer' })))
  await sessionRuntime.sendMessage({ content: 'same', streamingBehavior: 'followUp' })
  expect(boundaries).toEqual([{ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] }])
  session.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: 'retry' })
  session.emit({ type: 'auto_retry_end', attempt: 1, success: true })
  expect(boundaries).toHaveLength(1)
  releaseFirstRequest()
  await completion
  expect(boundaries).toEqual([
    { type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] },
    { type: 'pi_turn_end', result: 'committed' },
    { type: 'pi_turn_start', piTurnIndex: 1, deliveries: ['steer', 'steer', 'steer'] },
    { type: 'pi_turn_end', result: 'committed' },
    { type: 'pi_turn_start', piTurnIndex: 2, deliveries: ['follow-up'] },
    { type: 'pi_turn_end', result: 'committed' },
    { type: 'pi_agent_settled' },
  ])
  expect(toolEvents.filter((event) => event.type === 'tool_started')).toHaveLength(3)
  expect(toolEvents.filter((event) => event.type === 'tool_finished').every((event) => event.result.status === 'success')).toBe(true)
  expect(toolEvents.at(-1)?.type).toBe('agent_completed')
  const usageEvents = runtimeEvents.filter((event) => event.type === 'context_usage_updated')
  expect(usageEvents).toHaveLength(3)
  expect(usageEvents.every((event) => event.source === 'step' && event.usage.tokens === 31_000)).toBe(true)
  for (const event of usageEvents) {
    expect(runtimeEvents[runtimeEvents.indexOf(event) + 1]?.type).toBe('pi_turn_end')
  }
  expect(session.setSteeringMode).toHaveBeenCalledWith('all')
  expect(session.setFollowUpMode).toHaveBeenCalledWith('all')
  await sessionRuntime.sendMessage({ content: 'queued before abort', streamingBehavior: 'steer' })
  expect(agent.hasQueuedMessages()).toBe(true)
  await sessionRuntime.cancel()
  expect(agent.hasQueuedMessages()).toBe(false)
  expect(session.clearQueue.mock.invocationCallOrder[0]).toBeLessThan(session.abort.mock.invocationCallOrder[0]!)
  runtime.dispose()
})
