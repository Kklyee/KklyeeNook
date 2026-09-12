import { existsSync } from 'node:fs'

import type {
  PiClientEventBody,
  PiHostUiResponse as PiExtensionUiResponse,
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

import { getActiveModel, getSavedModels, type ModelConfig } from '@/shared/agent/agentConfig'

import type { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { createPiApprovalExtension } from '@/main/approval/piApprovalExtension'
import type { AgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import { toPiClientEventBody } from '../client/piClientEventAdapter'
import {
  createPiExtensionUiBridge,
  type PiExtensionUiBridge,
} from '../adapters/piExtensionUiBridge'

export type PiSessionEventListener = (event: AgentSessionEvent) => void
export type PiSessionClientEventListener = (event: PiClientEventBody) => void
export type PiSessionProductEventListener = (event: AgentEvent) => void

/**
 * The minimal session-runtime interface consumed by the AgentRun adapter and
 * client-facing module. Tests can provide an in-memory adapter at this seam.
 */
export interface PiSessionRuntimePort {
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
  respondToExtensionUiRequest(response: PiExtensionUiResponse): void
  reloadConfiguration(): void
  subscribe(listener: PiSessionEventListener): () => void
  subscribeClientEvents(listener: PiSessionClientEventListener): () => void
  subscribeProductEvents(listener: PiSessionProductEventListener): () => void
  dispose(): void
}

/**
 * Long-lived runtime for one persisted Pi conversation. It owns the live Pi
 * SDK session and its model, tools, extensions, queues, and event streams.
 */
export class PiSessionRuntime implements PiSessionRuntimePort {
  private piSession: PiAgentSession | null = null
  private modelRuntime: ModelRuntime | null = null
  private initializePromise: Promise<void> | null = null
  private unsubscribePiSession: (() => void) | undefined
  private extensionUiBridge: PiExtensionUiBridge | null = null
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
    if (this.piSession) return
    if (this.initializePromise) return this.initializePromise
    this.initializePromise = this.createPiSession()
    try {
      await this.initializePromise
    } finally {
      this.initializePromise = null
    }
  }

  getSystemPrompt(): string {
    return this.getPiSession().systemPrompt
  }

  getSnapshot(metadata: PiThreadMetadata): PiThreadSnapshot {
    const session = this.getPiSession()
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
      hostUiRequests: this.extensionUiBridge?.pending() ?? [],
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
    const session = this.piSession
    return Boolean(
      this.initializePromise ||
      session?.isStreaming ||
      session?.isCompacting ||
      session?.isRetrying,
    )
  }

  async sendMessage(input: PiSendMessageInput): Promise<void> {
    await this.prompt(input, 'accepted')
  }

  async runMessage(input: PiSendMessageInput): Promise<void> {
    await this.prompt(input, 'settled')
  }

  private async prompt(input: PiSendMessageInput, waitFor: 'accepted' | 'settled'): Promise<void> {
    await this.initialize()
    const options: NonNullable<Parameters<PiAgentSession['prompt']>[1]> = {}
    if (input.streamingBehavior) options.streamingBehavior = input.streamingBehavior
    if (input.attachments?.length) options.images = input.attachments

    if (waitFor === 'accepted') {
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
      options.preflightResult = (success) => {
        if (success) settle()
      }
      void this.executePrompt(input.content, options).then(
        () => settle(),
        (error: unknown) => settle(error),
      )
      return accepted
    }

    await this.executePrompt(input.content, options)
  }

  private async executePrompt(
    content: string,
    options: NonNullable<Parameters<PiAgentSession['prompt']>[1]>,
  ): Promise<void> {
    try {
      await this.getPiSession().prompt(content, options)
      this.lastError = undefined
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.publishClientEvent({ type: 'error', error: this.lastError })
      throw error
    }
  }

  async cancel(): Promise<void> {
    await this.piSession?.abort()
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    return this.piSession?.clearQueue() ?? { steering: [], followUp: [] }
  }

  async getAvailableModels(): Promise<PiModelInfo[]> {
    await this.initialize()
    const runtime = this.getModelRuntime()
    try {
      await runtime.refresh()
    } catch (error) {
      console.warn('[PiSessionRuntime] failed to refresh available models:', error)
    }
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
    const configured = getSavedModels(this.configStore.get()).find(
      (item) => item.provider === input.provider && item.modelID === input.modelId,
    )
    if (!configured) throw new Error(`模型尚未配置: ${input.provider}/${input.modelId}`)
    const runtime = this.getModelRuntime()
    await this.configureModelRuntime(runtime, configured)
    const model = runtime.getModel(input.provider, input.modelId)
    if (!model) throw new Error(`找不到模型: ${input.provider}/${input.modelId}`)
    await this.getPiSession().setModel(model)
    this.lastError = undefined
  }

  setThinkingLevel(level: PiThinkingLevel): void {
    this.getPiSession().setThinkingLevel(level)
  }

  setSessionName(title: string): void {
    this.getPiSession().setSessionName(title)
  }

  respondToExtensionUiRequest(response: PiExtensionUiResponse): void {
    if (!this.extensionUiBridge?.respond(response)) {
      throw new Error(`Unknown Pi extension UI request: ${response.requestId}`)
    }
  }

  reloadConfiguration(): void {
    if (this.isRunning()) throw new Error('Cannot change agent settings while a run is active')
    this.resetPiSession()
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
    this.resetPiSession()
    this.listeners.clear()
    this.clientEventListeners.clear()
    this.productEventListeners.clear()
  }

  private resetPiSession(): void {
    this.unsubscribePiSession?.()
    this.unsubscribePiSession = undefined
    this.extensionUiBridge?.dispose()
    this.extensionUiBridge = null
    this.piSession?.dispose()
    this.piSession = null
    this.modelRuntime = null
    this.lastError = undefined
    this.turnIndex = -1
  }

  private getPiSession(): PiAgentSession {
    if (!this.piSession) throw new Error('Pi session is not initialized')
    return this.piSession
  }

  private getModelRuntime(): ModelRuntime {
    if (!this.modelRuntime) throw new Error('Model runtime is not initialized')
    return this.modelRuntime
  }

  private async createPiSession(): Promise<void> {
    const config = this.configStore.get()
    const activeModel = getActiveModel(config)
    const { provider, modelID, thinkingLevel } = activeModel

    let createdSession: PiAgentSession | undefined
    try {
      const modelRuntime = await ModelRuntime.create()
      await this.configureModelRuntime(modelRuntime, activeModel)
      const model = modelRuntime.getModel(provider, modelID)
      if (!model) throw new Error(`找不到模型: ${provider}/${modelID}`)

      const cwd = config.cwd
      if (!cwd) throw new Error('Agent workspace is not configured')
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

      this.piSession = session
      this.modelRuntime = modelRuntime
      this.extensionUiBridge = createPiExtensionUiBridge({
        nextRequestId: () => `${this.sessionId}:ui:${++this.requestCounter}`,
        currentToolCallId: () => {
          const pending = session.state.pendingToolCalls
          return pending.size === 1 ? pending.values().next().value : undefined
        },
        onRequest: (request) => this.publishClientEvent({ type: 'extension_ui_request', request }),
        onResolved: (requestId) =>
          this.publishClientEvent({ type: 'extension_ui_resolved', requestId }),
      })
      await session.bindExtensions({ uiContext: this.extensionUiBridge.ui })
      await this.runtimeStateRepo.save({
        sessionId: this.sessionId,
        runtimeKind: 'pi',
        resumeRef: session.sessionFile,
        updatedAt: Date.now(),
      })
      createdSession = undefined
      this.unsubscribePiSession = session.subscribe((event) => this.onSessionEvent(event))
    } catch (error) {
      createdSession?.dispose()
      this.piSession = null
      this.modelRuntime = null
      this.extensionUiBridge?.dispose()
      this.extensionUiBridge = null
      throw error
    }
  }

  private async configureModelRuntime(runtime: ModelRuntime, config: ModelConfig): Promise<void> {
    const apiKey = this.credentialStore.getApiKey(config.provider)
    if (!apiKey) throw new Error(`Provider "${config.provider}" 没有配置 API Key`)

    runtime.unregisterProvider(config.provider)
    if (config.baseUrl) {
      const builtinModel =
        !config.providerName && !config.contextWindow && !config.maxTokens
          ? runtime.getModel(config.provider, config.modelID)
          : undefined
      runtime.registerProvider(
        config.provider,
        builtinModel
          ? { baseUrl: config.baseUrl }
          : {
              name: config.providerName ?? config.provider,
              baseUrl: config.baseUrl,
              api: 'openai-completions',
              authHeader: true,
              models: [
                {
                  id: config.modelID,
                  name: config.modelID,
                  reasoning: false,
                  input: ['text'],
                  contextWindow: config.contextWindow ?? 128_000,
                  maxTokens: config.maxTokens ?? 1_000,
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
            },
      )
    }
    await runtime.setRuntimeApiKey(config.provider, apiKey)
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
      const contextUsage = this.getPiSession().getContextUsage()
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
      console.error('[PiSessionRuntime] listener failed:', error)
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
