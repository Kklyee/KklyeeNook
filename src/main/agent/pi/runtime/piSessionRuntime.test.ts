import { expect, test, vi } from 'vitest'

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'
import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import type { AgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import type { CredentialStore } from '@/main/settings/credentialStore'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import { PiSessionRuntime } from './piSessionRuntime'

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: class {
    async reload() {}
  },
  ModelRuntime: { create: vi.fn() },
  SessionManager: { create: vi.fn() },
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
    dispose: vi.fn(),
  }
}

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
  vi.mocked(SessionManager.create).mockReturnValue({} as never)
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
  })
  const sessionRuntime = new PiSessionRuntime(
    'session-1',
    configStore,
    { getApiKey: () => 'secret' } as unknown as CredentialStore,
    {} as ApprovalPolicy,
    { findBySessionId: vi.fn(), save: vi.fn() } as unknown as AgentRuntimeStateRepo,
    { resolve: vi.fn(() => []) } as unknown as ToolRegistry,
    'sessions',
  )
  const events: string[] = []
  sessionRuntime.subscribeClientEvents((event) => events.push(event.type))

  await sessionRuntime.initialize()
  expect(runtime.registerProvider).toHaveBeenCalledWith(
    'custom',
    expect.objectContaining({
      name: 'Custom Provider',
      models: [expect.objectContaining({ contextWindow: 32_000, maxTokens: 4_000 })],
    }),
  )

  sessionRuntime.reloadConfiguration()
  expect(firstSession.dispose).toHaveBeenCalledOnce()
  await sessionRuntime.initialize()
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
  vi.mocked(SessionManager.create).mockReturnValue({} as never)
  vi.mocked(createAgentSession).mockResolvedValue({ session: fakeSession() } as never)

  const sessionRuntime = new PiSessionRuntime(
    'session-1',
    new AgentConfigStore({
      model: {
        provider: 'deepseek',
        modelID: 'deepseek-v4-flash',
        thinkingLevel: 'off',
      },
      tools: { enabled: [] },
      cwd: 'C:\\workspace',
    }),
    { getApiKey: () => 'secret' } as unknown as CredentialStore,
    {} as ApprovalPolicy,
    { findBySessionId: vi.fn(), save: vi.fn() } as unknown as AgentRuntimeStateRepo,
    { resolve: vi.fn(() => []) } as unknown as ToolRegistry,
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
