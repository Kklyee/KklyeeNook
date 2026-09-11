import { existsSync } from 'node:fs'

import type {
  PiClientEventBody,
  PiHostUiResponse,
  PiModelInfo,
  PiSendMessageInput,
  PiThinkingLevel,
  PiThreadMetadata,
  PiThreadSnapshot,
  PiTranscriptMessage,
} from '@assistant-ui/react-pi/node'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession as PiAgentSession,
  type AgentSessionEvent,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'

import type { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { createPiApprovalExtension } from '@/main/approval/piApprovalExtension'
import type { AgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import { toPiClientEventBody } from '../client/piClientEventAdapter'
import { createPiHostUiBridge, type PiHostUiBridge } from '../adapters/piHostUiBridge'

export type PiSessionEventListener = (event: AgentSessionEvent) => void
export type PiSessionClientEventListener = (event: PiClientEventBody) => void
export type PiSessionProductEventListener = (event: AgentEvent) => void

export interface PiSessionHostLike {
  initialize(): Promise<void>
  getSystemPrompt(): string
  getSnapshot(metadata: PiThreadMetadata): PiThreadSnapshot
  isRunning(): boolean
  sendMessage(input: PiSendMessageInput): Promise<void>
  runMessage(input: PiSendMessageInput): Promise<void>
  cancel(): Promise<void>
  clearQueue(): { steering: string[]; followUp: string[] }
  getAvailableModels(): Promise<PiModelInfo[]>
  setModel(input: { provider: string; modelId: string }): Promise<void>
  setThinkingLevel(level: PiThinkingLevel): void
  setSessionName(title: string): void
  respondToHostUiRequest(response: PiHostUiResponse): void
  subscribe(listener: PiSessionEventListener): () => void
  subscribeClientEvents(listener: PiSessionClientEventListener): () => void
  subscribeProductEvents(listener: PiSessionProductEventListener): () => void
  dispose(): void
}

export class PiSessionHost implements PiSessionHostLike {
  private session: PiAgentSession | null = null
  private modelRuntime: ModelRuntime | null = null
  private initializePromise: Promise<void> | null = null
  private unsubscribeSession: (() => void) | undefined
  private uiBridge: PiHostUiBridge | null = null
  private requestCounter = 0
  private turnIndex = -1
  private lastError: string | undefined
  private readonly listeners = new Set<PiSessionEventListener>()
  private readonly clientEventListeners = new Set<PiSessionClientEventListener>()
  private readonly productEventListeners = new Set<PiSessionProductEventListener>()

  constructor(
    private readonly sessionId: string,
    private readonly configStore: AgentConfigStore,
    private readonly credentialStore: CredentialStore,
    private readonly approvalPolicy: ApprovalPolicy,
    private readonly runtimeStateRepo: AgentRuntimeStateRepo,
    private readonly toolRegistry: ToolRegistry,
    private readonly sessionDir: string,
  ) {}

  async initialize(): Promise<void> {
    if (this.session) return
    if (this.initializePromise) return this.initializePromise
    this.initializePromise = this.createSession()
    try {
      await this.initializePromise
    } finally {
      this.initializePromise = null
    }
  }

  getSystemPrompt(): string {
    return this.getSession().systemPrompt
  }

  getSnapshot(metadata: PiThreadMetadata): PiThreadSnapshot {
    const session = this.getSession()
    const model = session.model
    const contextUsage = session.getContextUsage()
    const queuedMessages = [
      ...session
        .getSteeringMessages()
        .map((content, index) => ({
          id: `pi-queue:steer:${index}`,
          mode: 'steer' as const,
          content,
        })),
      ...session
        .getFollowUpMessages()
        .map((content, index) => ({
          id: `pi-queue:followUp:${index}`,
          mode: 'followUp' as const,
          content,
        })),
    ]

    return {
      metadata: {
        ...metadata,
        status: this.lastError ? 'failed' : this.isRunning() ? 'running' : 'idle',
        sessionFile: session.sessionFile,
        messageCount: session.messages.length,
        config: {
          ...(model ? { provider: model.provider, modelId: model.id } : {}),
          thinkingLevel: session.thinkingLevel,
        },
        ...(contextUsage ? { contextUsage } : {}),
        ...(queuedMessages.length ? { queuedMessages } : {}),
      },
      messages: session.messages as unknown as PiTranscriptMessage[],
      hostUiRequests: this.uiBridge?.pending() ?? [],
      readiness: model
        ? {
            state: 'ready',
            selection: { provider: model.provider, modelId: model.id },
            source: 'session',
          }
        : { state: 'missing-model', message: 'No model selected' },
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }

  isRunning(): boolean {
    const session = this.session
    return Boolean(session?.isStreaming || session?.isCompacting || session?.isRetrying)
  }

  async sendMessage(input: PiSendMessageInput): Promise<void> {
    await this.initialize()
    const session = this.getSession()
    const promptOptions: NonNullable<Parameters<PiAgentSession['prompt']>[1]> = {}
    if (input.streamingBehavior) promptOptions.streamingBehavior = input.streamingBehavior
    if (input.attachments?.length) promptOptions.images = input.attachments

    let settle: (error?: unknown) => void = () => undefined
    let settled = false
    const accepted = new Promise<void>((resolve, reject) => {
      settle = (error) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve()
      }
    })
    promptOptions.preflightResult = (success) => {
      if (success) settle()
    }

    void session.prompt(input.content, promptOptions).then(
      () => {
        this.lastError = undefined
        settle()
      },
      (error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.publishClientEvent({ type: 'error', error: this.lastError })
        settle(error)
      },
    )
    await accepted
  }

  async runMessage(input: PiSendMessageInput): Promise<void> {
    await this.initialize()
    const options: NonNullable<Parameters<PiAgentSession['prompt']>[1]> = {}
    if (input.streamingBehavior) options.streamingBehavior = input.streamingBehavior
    if (input.attachments?.length) options.images = input.attachments
    try {
      await this.getSession().prompt(input.content, options)
      this.lastError = undefined
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.publishClientEvent({ type: 'error', error: this.lastError })
      throw error
    }
  }

  async cancel(): Promise<void> {
    await this.session?.abort()
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    return this.session?.clearQueue() ?? { steering: [], followUp: [] }
  }

  async getAvailableModels(): Promise<PiModelInfo[]> {
    await this.initialize()
    const runtime = this.getModelRuntime()
    try {
      await runtime.refresh()
    } catch {}
    const models = runtime.getAvailableSnapshot()
    return (models.length ? models : runtime.getModels()).map((model) => ({
      provider: String(model.provider),
      modelId: model.id,
      name: model.name,
      supportsThinking: Boolean(model.reasoning),
    }))
  }

  async setModel(input: { provider: string; modelId: string }): Promise<void> {
    await this.initialize()
    const model = this.getModelRuntime().getModel(input.provider, input.modelId)
    if (!model) throw new Error(`找不到模型: ${input.provider}/${input.modelId}`)
    await this.getSession().setModel(model)
    this.lastError = undefined
  }

  setThinkingLevel(level: PiThinkingLevel): void {
    this.getSession().setThinkingLevel(level)
  }

  setSessionName(title: string): void {
    this.getSession().setSessionName(title)
  }

  respondToHostUiRequest(response: PiHostUiResponse): void {
    if (!this.uiBridge?.respond(response)) {
      throw new Error(`Unknown Pi host UI request: ${response.requestId}`)
    }
  }

  subscribe(listener: PiSessionEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeClientEvents(listener: PiSessionClientEventListener): () => void {
    this.clientEventListeners.add(listener)
    return () => this.clientEventListeners.delete(listener)
  }

  subscribeProductEvents(listener: PiSessionProductEventListener): () => void {
    this.productEventListeners.add(listener)
    return () => this.productEventListeners.delete(listener)
  }

  dispose(): void {
    this.unsubscribeSession?.()
    this.unsubscribeSession = undefined
    this.uiBridge?.dispose()
    this.uiBridge = null
    this.session?.dispose()
    this.session = null
    this.modelRuntime = null
    this.listeners.clear()
    this.clientEventListeners.clear()
    this.productEventListeners.clear()
  }

  private getSession(): PiAgentSession {
    if (!this.session) throw new Error('Session is not initialized')
    return this.session
  }

  private getModelRuntime(): ModelRuntime {
    if (!this.modelRuntime) throw new Error('Model runtime is not initialized')
    return this.modelRuntime
  }

  private async createSession(): Promise<void> {
    const config = this.configStore.get()
    const { provider, modelID, thinkingLevel, baseUrl } = config.model
    const apiKey = this.credentialStore.getApiKey(provider)
    if (!apiKey) throw new Error(`Provider "${provider}" 没有配置 API Key`)

    let createdSession: PiAgentSession | undefined
    try {
      const modelRuntime = await ModelRuntime.create()
      if (baseUrl) {
        modelRuntime.registerProvider(provider, {
          name: 'B.AI',
          baseUrl,
          api: 'openai-completions',
          authHeader: true,
          models: [
            {
              id: modelID,
              name: modelID,
              reasoning: false,
              input: ['text'],
              contextWindow: 128_000,
              maxTokens: 1_000,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              samplingParams: { temperature: 0.7 },
              compat: {
                maxTokensField: 'max_tokens',
                supportsUsageInStreaming: false,
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
              },
            },
          ],
        })
      }
      await modelRuntime.setRuntimeApiKey(provider, apiKey)
      const model = modelRuntime.getModel(provider, modelID)
      if (!model) throw new Error(`找不到模型: ${provider}/${modelID}`)

      const cwd = config.cwd ?? process.cwd()
      const tools = this.toolRegistry.resolve<PiToolDefinition<any, any, any>>(
        'pi',
        config.tools.enabled,
        { cwd },
      )
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: cwd,
        extensionFactories: [
          createPiApprovalExtension(this.sessionId, this.approvalPolicy, (event) =>
            this.publishProductEvent(event),
          ),
        ],
      })
      await resourceLoader.reload()
      const sessionManager = await this.createSessionManager(cwd)
      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel: thinkingLevel ?? 'medium',
        noTools: 'builtin',
        tools: config.tools.enabled,
        customTools: tools,
        resourceLoader,
        sessionManager,
      })
      createdSession = session
      if (session.sessionId !== this.sessionId) {
        throw new Error(
          `Pi session ID mismatch: expected ${this.sessionId}, got ${session.sessionId}`,
        )
      }
      if (!session.sessionFile) {
        throw new Error('Persistent Pi session did not provide a session file')
      }

      this.session = session
      this.modelRuntime = modelRuntime
      this.uiBridge = createPiHostUiBridge({
        nextRequestId: () => `${this.sessionId}:ui:${++this.requestCounter}`,
        currentToolCallId: () => {
          const pending = session.state.pendingToolCalls
          return pending.size === 1 ? pending.values().next().value : undefined
        },
        onRequest: (request) => this.publishClientEvent({ type: 'extension_ui_request', request }),
        onResolved: (requestId) =>
          this.publishClientEvent({ type: 'extension_ui_resolved', requestId }),
      })
      await session.bindExtensions({ uiContext: this.uiBridge.ui })
      await this.runtimeStateRepo.save({
        sessionId: this.sessionId,
        runtimeKind: 'pi',
        resumeRef: session.sessionFile,
        updatedAt: Date.now(),
      })
      createdSession = undefined
      this.unsubscribeSession = session.subscribe((event) => this.onSessionEvent(event))
    } catch (error) {
      createdSession?.dispose()
      this.session = null
      this.modelRuntime = null
      this.uiBridge?.dispose()
      this.uiBridge = null
      throw error
    }
  }

  private onSessionEvent(event: AgentSessionEvent): void {
    if (event.type === 'turn_start') this.turnIndex += 1
    for (const listener of this.listeners) this.notify(listener, event)
    this.publishClientEvent(toPiClientEventBody(event, this.turnIndex))
    if (
      event.type === 'turn_end' ||
      event.type === 'agent_end' ||
      event.type === 'compaction_end'
    ) {
      const contextUsage = this.getSession().getContextUsage()
      if (contextUsage) this.publishClientEvent({ type: 'context_usage', contextUsage })
    }
  }

  private publishClientEvent(event: PiClientEventBody): void {
    for (const listener of this.clientEventListeners) this.notify(listener, event)
  }

  private publishProductEvent(event: AgentEvent): void {
    for (const listener of this.productEventListeners) this.notify(listener, event)
  }

  private notify<T>(listener: (event: T) => void, event: T): void {
    try {
      listener(event)
    } catch (error) {
      console.error('[PiSessionHost] listener failed:', error)
    }
  }

  private async createSessionManager(cwd: string): Promise<SessionManager> {
    const state = await this.runtimeStateRepo.findBySessionId(this.sessionId)
    if (!state || !existsSync(state.resumeRef)) {
      return SessionManager.create(cwd, this.sessionDir, { id: this.sessionId })
    }
    if (state.runtimeKind !== 'pi')
      throw new Error(`Unsupported runtime kind: ${state.runtimeKind}`)
    const manager = SessionManager.open(state.resumeRef, this.sessionDir, cwd)
    if (manager.getSessionId() !== this.sessionId) {
      throw new Error(
        `Pi session mismatch: expected ${this.sessionId}, got ${manager.getSessionId()}`,
      )
    }
    return manager
  }
}
