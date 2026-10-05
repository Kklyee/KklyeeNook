import { SandboxService } from '@/main/sandbox/sandboxService'
import { shellRuntimeContext } from '@/main/sandbox/shellRuntime'
import { ToolExecutionHarness } from '@/main/agent/toolExecutionHarness'
import { FileToolResultRetentionPolicy } from '@/main/tools/toolResultRetentionPolicy'
import { ToolResultStore } from '@/main/tools/toolResultStore'
import { installPiToolExecutionHarness } from '../adapters/piToolExecutionAdapter'
import { normalizePiToolExecutionEnd } from '../adapters/piEventAdapter'
import { effectivePermissionMode, type PermissionMode } from '@/shared/approval/permission'
import { mkdir } from 'node:fs/promises'
import type { AgentExecutionContext } from '@/shared/workspace/workspace'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

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
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession as PiAgentSession,
  type AgentSessionEvent,
  type Skill as PiSkill,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'

import {
  getActiveModel,
  getConfiguredProviders,
  getSavedModels,
  getAgentCompactionSettings,
  type AgentConfig,
  type ModelConfig,
  type ThinkingLevel,
} from '@/shared/agent/agentConfig'
import { resolveModelInput } from '@/shared/agent/modelCapabilities'
import { webSearchCredentialId } from '@/shared/web-search/webSearch'
import {
  getConfiguredModelConfigs,
  getModelCatalog,
  hasBuiltinModel,
  mergeConfiguredProvidersIntoCatalog,
} from '@/main/settings/modelCatalog'

import { createPiApprovalExtension } from '@/main/approval/piApprovalExtension'
import type { AgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { PiQueueMutation, PiQueueSnapshot } from '@/shared/pi/piClient'
import type { InputDelivery } from '@/shared/agent/agentEvent'
import type { ExecutionBoundaryEvent } from '@/main/agent/agentRuntime'
import type { AgentSkill } from '@/shared/agent/agentSkill'
import {
  toAgentContextUsage,
  type AgentContextUsage,
} from '@/shared/agent/agentContextUsage'
import { toPiClientEventBody } from '../client/piClientEventAdapter'
import {
  createPiExtensionUiBridge,
  type PiExtensionUiBridge,
} from '../adapters/piExtensionUiBridge'
import type { AgentRunContext } from '@/main/context/contextBuilder'
import { toPiContextMessage } from '../adapters/piContextAdapter'

export type PiSessionEventListener = (event: AgentSessionEvent) => void
export type PiSessionClientEventListener = (event: PiClientEventBody) => void
export type PiSessionProductEventListener = (event: AgentEvent) => void
export type PiSessionExecutionEventListener = (event: ExecutionBoundaryEvent) => void

const APP_THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

function usesBearerAuth(api: string): boolean {
  return [
    'openai-completions',
    'openai-responses',
    'openai-codex-responses',
    'anthropic-messages',
    'mistral-conversations',
  ].includes(api)
}

/**
 * The minimal session-runtime interface consumed by the AgentRun adapter and
 * client-facing module. Tests can provide an in-memory adapter at this seam.
 */
export interface PiSessionRuntimePort {
  initialize(): Promise<void>
  getSystemPrompt(): string
  getContextUsage(): AgentContextUsage | undefined
  getSnapshot(metadata: PiThreadMetadata): PiThreadSnapshot
  isRunning(): boolean
  compact(customInstructions?: string): Promise<void>
  sendMessage(input: PiSendMessageInput): Promise<void>
  runMessage(
    input: PiSendMessageInput,
    context?: AgentRunContext,
    skillIds?: readonly string[],
    runId?: string,
  ): Promise<void>
  cancel(): Promise<void>
  clearQueue(): { steering: string[]; followUp: string[] }
  updateQueuedMessage(input: PiQueueMutation): PiQueueSnapshot
  getAvailableModels(): Promise<PiModelInfo[]>
  applyConfiguredModelSelection(): Promise<void>
  setModel(input: { provider: string; modelId: string }): Promise<void>
  setThinkingLevel(level: PiThinkingLevel): void
  setSessionName(title: string): void
  respondToExtensionUiRequest(response: PiExtensionUiResponse): void
  forwardClientEvent?(event: PiClientEventBody): void
  reloadConfiguration(): void
  subscribe(listener: PiSessionEventListener): () => void
  subscribeClientEvents(listener: PiSessionClientEventListener): () => void
  subscribeProductEvents(listener: PiSessionProductEventListener): () => void
  subscribeExecutionEvents(listener: PiSessionExecutionEventListener): () => void
  dispose(): void
}

export interface PiSessionRuntimeOptions {
  sandbox?: SandboxService
  getExecutionContext?: () => Promise<AgentExecutionContext & { mode?: PermissionMode }>
  persistState?: boolean
  permissionSessionId?: string
  hostUiEventSink?: (event: PiClientEventBody) => void
}

/**
 * Long-lived runtime for one persisted Pi conversation. It owns the live Pi
 * SDK session and its model, tools, extensions, queues, and event streams.
 */
export class PiSessionRuntime implements PiSessionRuntimePort {
  private compactionUsage?: AgentContextUsage
  private readonly sandbox: SandboxService
  private readonly getExecutionContext: () => Promise<AgentExecutionContext & { mode?: PermissionMode }>
  private executionContextKey: string | undefined
  private piSession: PiAgentSession | null = null
  private modelRuntime: ModelRuntime | null = null
  private initializePromise: Promise<void> | null = null
  private unsubscribePiSession: (() => void) | undefined
  private extensionUiBridge: PiExtensionUiBridge | null = null
  private requestCounter = 0
  private turnIndex = -1
  private lastError: string | undefined
  private activeRunId: string | undefined
  private registeredToolRegistryRevision = -1
  private readonly listeners = new Set<PiSessionEventListener>()
  private readonly clientEventListeners = new Set<PiSessionClientEventListener>()
  private readonly productEventListeners = new Set<PiSessionProductEventListener>()
  private readonly executionEventListeners = new Set<PiSessionExecutionEventListener>()
  private readonly pendingDeliveries = new Set<Promise<void>>()
  private queueGeneration = 0
  private unsubscribeDeliveryBarrier?: () => void
  private pendingPiTurn = false
  private deliveredInputs: InputDelivery[] = []
  private readonly inputDeliveries = new WeakMap<object, InputDelivery>()

  constructor(
    private readonly sessionId: string,
    private readonly configStore: AgentConfigStore,
    private readonly credentialStore: CredentialStore,
    private readonly runtimeStateRepo: AgentRuntimeStateRepo,
    private readonly toolRegistry: ToolRegistry,
    private readonly sessionDir: string,
    private readonly skillDirectory = join(homedir(), '.agents', 'skills'),
    private readonly getLoadedSkills: () => readonly AgentSkill[] = () => [],
    options: PiSessionRuntimeOptions = {},
  ) {
    this.persistState = options.persistState ?? true
    this.permissionSessionId = options.permissionSessionId ?? sessionId
    this.hostUiEventSink = options.hostUiEventSink
    this.sandbox = options.sandbox ?? new SandboxService()
    this.getExecutionContext = options.getExecutionContext ?? (async () => ({ conversationId: this.permissionSessionId }))
  }

  private readonly persistState: boolean
  private readonly permissionSessionId: string
  private readonly hostUiEventSink?: (event: PiClientEventBody) => void

  async initialize(): Promise<void> {
    if (this.piSession && !this.isRunning()) {
      const key = JSON.stringify(await this.getExecutionContext())
      if (key !== this.executionContextKey) this.resetPiSession()
    }
    if (
      this.piSession &&
      !this.isRunning() &&
      this.registeredToolRegistryRevision !== this.toolRegistry.getRevision()
    ) {
      this.resetPiSession()
    }
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
    const prompt = this.getPiSession().systemPrompt
    const executionContextKey = this.executionContextKey
    if (!executionContextKey) return prompt
    if (hasWorkspaceContext(executionContextKey)) {
      const context = JSON.parse(executionContextKey) as AgentExecutionContext
      return prompt.replace(/Current working directory: [^\n]*/g, () => 'Current working directory: ' + context.workspace!.rootPath)
    }
    return prompt.replace(/\nCurrent working directory: [^\n]*\n?/g, '\n')
  }

  getContextUsage(): AgentContextUsage | undefined {
    return toAgentContextUsage(this.getPiSession().getContextUsage())
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
        status: metadata.status === 'running' || this.isRunning()
          ? 'running'
          : this.lastError ? 'failed' : 'idle',
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

  async compact(customInstructions?: string): Promise<void> {
    if (this.isRunning()) throw new Error('运行中无法整理上下文')
    await this.initialize()
    if (this.isRunning()) throw new Error('运行中无法整理上下文')
    await this.getPiSession().compact(customInstructions || undefined)
  }

  async sendMessage(input: PiSendMessageInput): Promise<void> {
    const generation = this.queueGeneration
    const delivery = (async () => {
      await this.initialize()
      if (generation !== this.queueGeneration) throw new Error('队列已清空，请重新发送')
      const session = this.getPiSession()
      const content = input.content.startsWith('/')
        ? normalizePiSkillCommand(input.content, session.resourceLoader.getSkills().skills)
        : input.content
      if (input.streamingBehavior === 'steer') await session.steer(content, input.attachments)
      else await session.followUp(content, input.attachments)
    })()
    this.pendingDeliveries.add(delivery)
    try {
      await delivery
    } finally {
      this.pendingDeliveries.delete(delivery)
    }
  }

  async runMessage(
    input: PiSendMessageInput,
    context?: AgentRunContext,
    skillIds: readonly string[] = [],
    runId?: string,
  ): Promise<void> {
    await this.initialize()
    const previousRunId = this.activeRunId
    this.activeRunId = runId
    try {
      const message = context ? toPiContextMessage(context) : undefined
      if (!message) {
        await this.prompt(input, skillIds)
        return
      }
      if (!context?.memories?.length) {
        await this.getPiSession().sendCustomMessage(message, { deliverAs: 'nextTurn' })
        await this.prompt(input, skillIds)
        return
      }

      const session = this.getPiSession()
      const transientMessage = {
        role: 'custom' as const,
        customType: message.customType,
        content: message.content,
        display: message.display,
        details: message.details,
        timestamp: Date.now(),
      }
      session.state.messages = [...session.state.messages, transientMessage]
      try {
        await this.prompt(input, skillIds)
      } finally {
        session.state.messages = session.state.messages.filter(
          (candidate) => candidate !== transientMessage,
        )
      }
    } finally {
      this.activeRunId = previousRunId
    }
  }

  private async prompt(
    input: PiSendMessageInput,
    skillIds: readonly string[] = [],
  ): Promise<void> {
    await this.initialize()
    const options: NonNullable<Parameters<PiAgentSession['prompt']>[1]> = {}
    if (input.streamingBehavior) options.streamingBehavior = input.streamingBehavior
    if (input.attachments?.length) options.images = input.attachments

    await this.executePrompt(input.content, options, skillIds)
  }

  private async executePrompt(
    content: string,
    options: NonNullable<Parameters<PiAgentSession['prompt']>[1]>,
    skillIds: readonly string[] = [],
  ): Promise<void> {
    try {
      const session = this.getPiSession()
      const prompt = skillIds.length
        ? expandPiSkills(content, skillIds, session.resourceLoader.getSkills().skills)
        : content.startsWith('/')
        ? normalizePiSkillCommand(content, session.resourceLoader.getSkills().skills)
        : content
      await session.prompt(prompt, options)
      this.lastError = undefined
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.publishClientEvent({ type: 'error', error: this.lastError })
      throw error
    }
  }

  async cancel(): Promise<void> {
    this.clearQueue()
    await this.piSession?.abort()
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    this.queueGeneration += 1
    return this.piSession?.clearQueue() ?? { steering: [], followUp: [] }
  }

  updateQueuedMessage(input: PiQueueMutation): PiQueueSnapshot {
    return this.getPiSession().updateQueuedMessage(input.mode, input.expected, input.index, input.action, 'value' in input ? input.value : undefined)
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
      availableThinkingLevels: getSupportedThinkingLevels(model)
        .filter((level): level is ThinkingLevel => APP_THINKING_LEVELS.includes(level))
        .map((level) => level as PiThinkingLevel),
    }))
  }

  async applyConfiguredModelSelection(): Promise<void> {
    await this.initialize()
    if (this.isRunning()) return

    const activeModel = getActiveModel(this.configStore.get())
    const session = this.getPiSession()
    if (
      session.model?.provider !== activeModel.provider ||
      session.model?.id !== activeModel.modelID
    ) {
      await this.setModel({ provider: activeModel.provider, modelId: activeModel.modelID })
    }

    const thinkingLevel = activeModel.thinkingLevel ?? (activeModel.reasoning ? 'medium' : 'off')
    if (session.thinkingLevel !== thinkingLevel) {
      this.setThinkingLevel(thinkingLevel as PiThinkingLevel)
    }
  }

  async setModel(input: { provider: string; modelId: string }): Promise<void> {
    await this.initialize()
    const configured = getRuntimeModelConfigs(this.configStore.get()).find(
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

  forwardClientEvent(event: PiClientEventBody): void {
    this.publishClientEvent(event)
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

  subscribeExecutionEvents(listener: PiSessionExecutionEventListener): () => void {
    this.executionEventListeners.add(listener)
    return () => this.executionEventListeners.delete(listener)
  }

  dispose(): void {
    this.resetPiSession()
    this.listeners.clear()
    this.clientEventListeners.clear()
    this.productEventListeners.clear()
    this.executionEventListeners.clear()
  }

  private resetPiSession(): void {
    this.unsubscribePiSession?.()
    this.unsubscribePiSession = undefined
    this.unsubscribeDeliveryBarrier?.()
    this.unsubscribeDeliveryBarrier = undefined
    this.extensionUiBridge?.dispose()
    this.extensionUiBridge = null
    this.piSession?.dispose()
    this.piSession = null
    this.modelRuntime = null
    this.registeredToolRegistryRevision = -1
    this.lastError = undefined
    this.turnIndex = -1
    this.pendingPiTurn = false
    this.deliveredInputs = []
  }

  private getPiSession(): PiAgentSession {
    if (!this.piSession) throw new Error('Pi session is not initialized')
    return this.piSession
  }

  /**
   * Tools the app grants automatically from settings instead of the user-toggled tool list.
   * web_search stays invisible to the model until a provider and its key are configured.
   */
  private collectAutomaticTools(config: AgentConfig): string[] {
    const provider = config.webSearch?.provider ?? 'disabled'
    const available =
      provider !== 'disabled' && this.credentialStore.hasApiKey(webSearchCredentialId(provider))
    return available && this.toolRegistry.get('web_search') ? ['web_search'] : []
  }

  private getModelRuntime(): ModelRuntime {
    if (!this.modelRuntime) throw new Error('Model runtime is not initialized')
    return this.modelRuntime
  }

  private async createPiSession(): Promise<void> {
    const config = this.configStore.get()
    const resolved = await this.getExecutionContext()
    this.executionContextKey = JSON.stringify(resolved)
    const executionContext = { ...resolved, mode: effectivePermissionMode(resolved.mode, Boolean(resolved.workspace), config.defaultPermissionMode) }
    const cwd = executionContext.workspace?.rootPath ?? join(this.sessionDir, 'runtime', this.sessionId)
    await mkdir(cwd, { recursive: true })

    const sessionManager = await this.createSessionManager(cwd)
    const configuredModels = getRuntimeModelConfigs(config)
    const configuredActiveModel =
      configuredModels.find(
        (model) =>
          model.id === config.activeModelId ||
          (model.provider === config.model.provider && model.modelID === config.model.modelID),
      ) ?? getActiveModel(config)
    const activeModel = configuredActiveModel
    const { provider, modelID } = activeModel
    const thinkingLevel = activeModel.thinkingLevel ?? (activeModel.reasoning ? 'medium' : 'off')

    let createdSession: PiAgentSession | undefined
    try {
      const modelRuntime = await ModelRuntime.create()
      await this.configureModelRuntime(modelRuntime, activeModel)
      const model = modelRuntime.getModel(provider, modelID)
      if (!model) throw new Error(`找不到模型: ${provider}/${modelID}`)

      const automaticTools = this.collectAutomaticTools(config)
      const enabledTools = [
        ...new Set([
          ...config.tools.enabled.filter(
            (name) => name !== 'web_search' && !name.startsWith('mcp__') && this.toolRegistry.get(name),
          ),
          ...automaticTools,
          ...this.toolRegistry
            .list()
            .filter((definition) => definition.origin?.kind === 'mcp' || definition.name === 'read_tool_result')
            .map((definition) => definition.name),
        ]),
      ]
      const registryRevision = this.toolRegistry.getRevision()
      const tools = this.toolRegistry.resolve<PiToolDefinition<any, any, any>>(
        'pi',
        enabledTools,
        { cwd: executionContext.workspace?.rootPath, executionContext, getRunId: () => this.activeRunId },
      )
      const settingsManager = SettingsManager.create(cwd, this.sessionDir)
      settingsManager.applyOverrides({ compaction: getAgentCompactionSettings(config) })
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: this.sessionDir,
        noExtensions: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: !executionContext.workspace,
        systemPromptOverride: base => executionContext.workspace ? base : 'You are a helpful assistant. This conversation has no local workspace. Use global memory, knowledge, MCP and attachments. Local tools require explicit absolute paths and full access.',
        appendSystemPromptOverride: base => [...base, shellRuntimeContext(executionContext.workspace?.rootPath)],
        additionalSkillPaths: [this.skillDirectory],
        skillsOverride: (result) => mergeLoadedSkills(result, this.getLoadedSkills()),
        settingsManager,
        extensionFactories: [
          createPiApprovalExtension(executionContext),
        ],
      })
      await resourceLoader.reload()
      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel: thinkingLevel ?? 'medium',
        settingsManager,
        noTools: 'builtin',
        tools: enabledTools,
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
      session.setSteeringMode('all')
      session.setFollowUpMode('one-at-a-time')
      const steer = session.agent.steer.bind(session.agent)
      session.agent.steer = (message) => {
        this.inputDeliveries.set(message, 'steer')
        steer(message)
      }
      const followUp = session.agent.followUp.bind(session.agent)
      session.agent.followUp = (message) => {
        this.inputDeliveries.set(message, 'follow-up')
        followUp(message)
      }
      const transformContext = session.agent.transformContext
      session.agent.transformContext = async (messages, signal) => {
        this.startPendingPiTurn()
        return transformContext ? transformContext(messages, signal) : messages
      }
      this.unsubscribeDeliveryBarrier = session.agent.subscribe(async (event) => {
        if (event.type === 'agent_end') await Promise.allSettled(this.pendingDeliveries)
      })
      this.modelRuntime = modelRuntime
      this.registeredToolRegistryRevision = registryRevision
      this.extensionUiBridge = createPiExtensionUiBridge({
        nextRequestId: () => `${this.sessionId}:ui:${++this.requestCounter}`,
        currentToolCallId: () => {
          const pending = session.state.pendingToolCalls
          return pending.size === 1 ? pending.values().next().value : undefined
        },
        onRequest: (request) => {
          const event = { type: 'extension_ui_request' as const, request }
          this.publishClientEvent(event)
          this.hostUiEventSink?.(event)
        },
        onResolved: (requestId) => {
          const event = { type: 'extension_ui_resolved' as const, requestId }
          this.publishClientEvent(event)
          this.hostUiEventSink?.(event)
        },
      })
      await session.bindExtensions({ uiContext: this.extensionUiBridge.ui })
      const harness = new ToolExecutionHarness(
        this.toolRegistry,
        this.sandbox,
        new FileToolResultRetentionPolicy(new ToolResultStore(join(this.sessionDir, '..', 'tool-results'))),
        async (call, decision, signal) => {
          this.publishProductEvent({ type: 'approval_required', approvalId: call.id, call })
          const selected = await this.extensionUiBridge!.ui.select(decision.reason, ['允许一次', '拒绝'], { signal })
          const approved = selected === '允许一次'
          this.publishProductEvent({ type: 'approval_resolved', approvalId: call.id, toolCallId: call.id, decision: approved ? 'allow' : 'deny' })
          return approved
        },
      )
      installPiToolExecutionHarness(session.agent, this.toolRegistry, harness,
        { cwd: executionContext.workspace?.rootPath, executionContext }, () => this.activeRunId ?? this.sessionId)
      if (this.persistState) {
        await this.runtimeStateRepo.save({
          sessionId: this.sessionId,
          runtimeKind: 'pi',
          resumeRef: session.sessionFile,
          updatedAt: Date.now(),
        })
      }
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
    const builtinModel = hasBuiltinModel(config.provider, config.modelID)
      ? runtime.getModel(config.provider, config.modelID)
      : undefined
    const providerTemplate =
      typeof runtime.getModels === 'function' ? runtime.getModels(config.provider)[0] : undefined

    runtime.unregisterProvider(config.provider)
    if (builtinModel) {
      const resolvedInput = resolveModelInput(
        config.provider,
        config.modelID,
        config.input ?? builtinModel.input,
      )
      const builtinInputs = new Set(builtinModel.input)
      const needsInputOverride = resolvedInput.some((input) => !builtinInputs.has(input))
      const needsModelDefinition =
        needsInputOverride ||
        Boolean(
          config.contextWindow ||
          config.maxTokens ||
          config.reasoning !== undefined ||
          config.modelName ||
          config.api,
        )

      if (config.baseUrl || config.providerName || needsModelDefinition) {
        runtime.registerProvider(config.provider, {
          ...(config.providerName ? { name: config.providerName } : {}),
          ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
          ...(needsModelDefinition
            ? {
                models: runtime
                  .getModels(config.provider)
                  .map((model) => ({
                    id: model.id,
                    name:
                      model.id === config.modelID ? (config.modelName ?? model.name) : model.name,
                    api: model.id === config.modelID ? (config.api ?? model.api) : model.api,
                    baseUrl: model.baseUrl,
                    reasoning:
                      model.id === config.modelID && config.reasoning !== undefined
                        ? config.reasoning
                        : model.reasoning,
                    thinkingLevelMap: model.thinkingLevelMap,
                    input: resolveModelInput(
                      config.provider,
                      model.id,
                      model.id === config.modelID && config.input ? config.input : model.input,
                    ),
                    cost: model.cost,
                    contextWindow:
                      model.id === config.modelID && config.contextWindow
                        ? config.contextWindow
                        : model.contextWindow,
                    maxTokens:
                      model.id === config.modelID && config.maxTokens
                        ? config.maxTokens
                        : model.maxTokens,
                    samplingParams: model.samplingParams,
                    headers: model.headers,
                    compat: model.compat,
                  })),
              }
            : {}),
        })
      }
    } else {
      const api = config.api ?? providerTemplate?.api ?? 'openai-completions'
      const baseUrl = config.baseUrl ?? providerTemplate?.baseUrl
      if (!baseUrl) {
        throw new Error(`Provider "${config.provider}" 缺少 API 地址，无法注册自定义模型`)
      }

      const input = resolveModelInput(
        config.provider,
        config.modelID,
        config.input ?? providerTemplate?.input ?? ['text'],
      )
      runtime.registerProvider(config.provider, {
        name: config.providerName ?? providerTemplate?.provider ?? config.provider,
        baseUrl,
        api,
        ...(usesBearerAuth(api) ? { authHeader: true } : {}),
        models: [
          {
            id: config.modelID,
            name: config.modelName ?? config.modelID,
            api,
            baseUrl,
            reasoning: config.reasoning ?? providerTemplate?.reasoning ?? false,
            input,
            contextWindow: config.contextWindow ?? providerTemplate?.contextWindow ?? 128_000,
            maxTokens: config.maxTokens ?? providerTemplate?.maxTokens ?? 16_384,
            cost: providerTemplate?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            ...(providerTemplate?.thinkingLevelMap
              ? { thinkingLevelMap: providerTemplate.thinkingLevelMap }
              : {}),
            ...(providerTemplate?.samplingParams
              ? { samplingParams: providerTemplate.samplingParams }
              : { samplingParams: { temperature: 0.7 } }),
            ...(providerTemplate?.headers ? { headers: providerTemplate.headers } : {}),
            ...(providerTemplate?.compat
              ? { compat: providerTemplate.compat }
              : api === 'openai-completions'
                ? {
                    compat: {
                      maxTokensField: 'max_tokens',
                      supportsUsageInStreaming: false,
                      supportsDeveloperRole: false,
                      supportsReasoningEffort: false,
                    },
                  }
                : {}),
          },
        ],
      })
    }
    if (apiKey) await runtime.setRuntimeApiKey(config.provider, apiKey)
  }

  private onSessionEvent(event: AgentSessionEvent): void {
    const contextUsage = ['turn_end', 'agent_end', 'compaction_start', 'compaction_end'].includes(event.type)
      ? this.getPiSession().getContextUsage()
      : undefined
    const usage = toAgentContextUsage(contextUsage)
    if (event.type === 'tool_execution_end') normalizePiToolExecutionEnd(event)
    if (event.type === 'turn_start') {
      this.turnIndex += 1
      this.pendingPiTurn = true
      this.deliveredInputs = []
    }
    if (event.type === 'message_start' && event.message.role === 'user') {
      this.deliveredInputs.push(this.inputDeliveries.get(event.message) ?? 'initial')
    }
    if (event.type === 'turn_end') {
      this.startPendingPiTurn()
      if (usage) this.publishProductEvent({ type: 'context_usage_updated', usage, source: 'step' })
      this.publishExecutionEvent({
        type: 'pi_turn_end',
        result: event.message.role === 'assistant' && ['error', 'aborted'].includes(event.message.stopReason)
          ? 'aborted' : 'committed',
      })
    }
    if (event.type === 'agent_settled') this.publishExecutionEvent({ type: 'pi_agent_settled' })
    for (const listener of this.listeners) this.notify(listener, event)
    this.publishClientEvent(toPiClientEventBody(event, this.turnIndex))
    if (event.type === 'compaction_start') {
      this.compactionUsage = usage
      this.publishProductEvent({
        type: 'context_compaction_started',
        reason: event.reason,
        tokensBefore: usage?.tokens,
        contextWindow: usage?.contextWindow,
      })
    }
    if (event.type === 'compaction_end') {
      if (!event.aborted && event.result) {
        this.publishProductEvent({
          type: 'context_compaction_completed',
          reason: event.reason,
          tokensBefore: event.result.tokensBefore,
          ...(event.result.estimatedTokensAfter !== undefined
            ? { estimatedTokensAfter: event.result.estimatedTokensAfter }
            : {}),
          contextWindow: this.compactionUsage?.contextWindow ?? usage?.contextWindow,
        })
        if (usage) this.publishProductEvent({ type: 'context_usage_updated', usage, source: 'compaction' })
      } else {
        this.publishProductEvent({
          type: 'context_compaction_failed',
          reason: event.reason,
          error:
            event.errorMessage ??
            (event.aborted ? 'Context compaction aborted' : 'Context compaction failed'),
          tokensBefore: this.compactionUsage?.tokens,
          contextWindow: this.compactionUsage?.contextWindow ?? usage?.contextWindow,
        })
      }
      this.compactionUsage = undefined
    }
    if (
      event.type === 'turn_end' ||
      event.type === 'agent_end' ||
      event.type === 'compaction_end'
    ) {
      if (contextUsage) this.publishClientEvent({ type: 'context_usage', contextUsage })
    }
  }

  private publishClientEvent(event: PiClientEventBody): void {
    for (const listener of this.clientEventListeners) this.notify(listener, event)
  }

  private startPendingPiTurn(): void {
    if (!this.pendingPiTurn) return
    this.pendingPiTurn = false
    this.publishExecutionEvent({
      type: 'pi_turn_start',
      piTurnIndex: this.turnIndex,
      deliveries: this.deliveredInputs,
      reasoning: this.getPiSession().thinkingLevel !== 'off',
    })
  }

  private publishExecutionEvent(event: ExecutionBoundaryEvent): void {
    for (const listener of this.executionEventListeners) this.notify(listener, event)
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
    if (!this.persistState)
      return SessionManager.create(cwd, this.sessionDir, { id: this.sessionId })
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

function expandPiSkills(
  content: string,
  skillIds: readonly string[],
  skills: readonly Pick<PiSkill, 'name' | 'baseDir' | 'filePath'>[],
): string {
  const blocks: string[] = []
  for (const skillId of skillIds) {
    const skill = skills.find((item) => item.name === skillId || basename(item.baseDir) === skillId)
    if (!skill) continue
    const body = stripSkillFrontmatter(readFileSync(skill.filePath, 'utf8')).trim()
    blocks.push(
      `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`,
    )
  }
  return blocks.length ? `${blocks.join('\n\n')}\n\n${content}` : content
}

function stripSkillFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

function mergeLoadedSkills(
  result: ReturnType<DefaultResourceLoader['getSkills']>,
  loadedSkills: readonly AgentSkill[],
): ReturnType<DefaultResourceLoader['getSkills']> {
  const existingPaths = new Set(result.skills.map((skill) => resolve(skill.filePath)))
  const existingNames = new Set(result.skills.map((skill) => skill.name))
  const skills = [...result.skills]

  for (const skill of loadedSkills) {
    const filePath = join(skill.directory, 'SKILL.md')
    const nativeSkill: PiSkill = {
      name: skill.name,
      description: skill.description ?? '',
      filePath,
      baseDir: skill.directory,
      sourceInfo: {
        path: filePath,
        source: 'local',
        scope: 'user',
        origin: 'top-level',
        baseDir: skill.directory,
      },
      disableModelInvocation: false,
    }
    if (existingPaths.has(resolve(filePath)) || existingNames.has(nativeSkill.name)) continue
    skills.push(nativeSkill)
    existingPaths.add(resolve(filePath))
    existingNames.add(nativeSkill.name)
  }

  return { ...result, skills }
}

export function normalizePiSkillCommand(
  content: string,
  skills: readonly Pick<PiSkill, 'name' | 'baseDir'>[],
): string {
  if (!content.startsWith('/') || content.startsWith('/skill:')) return content

  const match = /^\/([a-z0-9][a-z0-9-]*)(?=$|\s)([\s\S]*)$/.exec(content)
  if (!match) return content

  const commandName = match[1]
  const skill = skills.find(
    (item) => item.name === commandName || basename(item.baseDir) === commandName,
  )
  if (!skill) return content

  return `/skill:${skill.name}${match[2] ?? ''}`
}

function getRuntimeModelConfigs(config: AgentConfig) {
  const providers = getConfiguredProviders(config)
  const catalog = mergeConfiguredProvidersIntoCatalog(getModelCatalog(), providers)
  const expanded = getConfiguredModelConfigs(providers, catalog)
  if (!expanded.length) return getSavedModels(config)

  const savedModels = getSavedModels(config)
  return expanded.map((model) => {
    const saved = savedModels.find(
      (item) => item.provider === model.provider && item.modelID === model.modelID,
    )
    return saved?.thinkingLevel === undefined
      ? model
      : { ...model, thinkingLevel: saved.thinkingLevel }
  })
}

function hasWorkspaceContext(value: string): boolean {
  try {
    const context: unknown = JSON.parse(value)
    if (!isRecord(context) || !isRecord(context.workspace)) return false
    return (
      typeof context.workspace.id === 'string' &&
      typeof context.workspace.rootPath === 'string'
    )
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
