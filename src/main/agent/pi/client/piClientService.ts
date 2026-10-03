import type {
  PiClient,
  PiClientEvent,
  PiClientEventBody,
  PiHostUiResponse as PiExtensionUiResponse,
  PiModelInfo,
  PiSendMessageInput,
  PiThinkingLevel,
  PiThreadMetadata,
  PiThreadSnapshot,
} from '@assistant-ui/react-pi/node'

import type { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import {
  getModelCatalog,
  mergeConfiguredProvidersIntoCatalog,
  mergeSavedModelsIntoCatalog,
} from '@/main/settings/modelCatalog'
import { getActiveModel, getConfiguredProviders, getSavedModels } from '@/shared/agent/agentConfig'
import type { ContextBuilder } from '@/main/context/contextBuilder'
import type { ContextAttachmentService } from '@/main/context/contextAttachmentService'
import type { AgentService } from '../../agentService'
import type { MessageProjectionService } from '../../messageProjectionService'
import type { PiSessionRuntimePort } from '../runtime/piSessionRuntime'
import type { PiSessionRuntimeManager } from '../runtime/piSessionRuntimeManager'

type Listener = (event: PiClientEvent) => void
type Relay = {
  sessionRuntime: PiSessionRuntimePort
  listeners: Set<Listener>
  unsubscribe: () => void
  seq: number
  ready?: Promise<void>
  pendingUpdates: Map<string, PiClientEventBody>
  flushTimer?: ReturnType<typeof setTimeout>
}

export class PiClientService implements PiClient {
  private readonly relays = new Map<string, Relay>()

  constructor(
    private readonly agentService: AgentService,
    private readonly sessionRuntimeManager: PiSessionRuntimeManager,
    private readonly messageProjection: MessageProjectionService,
    private readonly configStore: AgentConfigStore,
    private readonly contextBuilder: ContextBuilder,
    private readonly contextAttachments: ContextAttachmentService,
  ) {}

  async listThreads(input?: {
    workspacePath?: string
    includeArchived?: boolean
  }): Promise<PiThreadMetadata[]> {
    void input?.workspacePath
    const sessions = await this.agentService.listSessions()
    return sessions
      .filter((session) => input?.includeArchived || !session.archived)
      .map((session) => this.metadataOf(session))
  }

  async createThread(input?: {
    workspacePath?: string
    title?: string
    initialMessage?: PiSendMessageInput
  }): Promise<PiThreadSnapshot> {
    void input?.workspacePath
    const session = await this.agentService.createSession(input?.title)
    const snapshot = await this.getThread(session.id)
    if (input?.initialMessage) await this.sendMessage(session.id, input.initialMessage)
    return input?.initialMessage ? this.getThread(session.id) : snapshot
  }

  async getThread(threadId: string): Promise<PiThreadSnapshot> {
    this.requireSession(threadId)
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()
    await sessionRuntime.applyConfiguredModelSelection()
    return sessionRuntime.getSnapshot(this.metadataOf(this.requireSession(threadId)))
  }

  async sendMessage(
    threadId: string,
    input: PiSendMessageInput,
    contextAttachmentIds: readonly string[] = [],
  ): Promise<void> {
    const uniqueContextAttachmentIds = [...new Set(contextAttachmentIds)]
    const session = this.requireSession(threadId)

    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()

    if (
      uniqueContextAttachmentIds.length &&
      (this.agentService.getSession(threadId)?.toSummary().activeRunId || sessionRuntime.isRunning())
    ) {
      throw new Error('File context cannot be added while the agent is running')
    }

    const context = await this.contextBuilder.build(
      uniqueContextAttachmentIds,
      session.workspaceId ?? undefined,
    )

    if (session.title === 'New Task') {
      const text = input.content.trim()
      const title = !text ? 'New Task' : text.length > 50 ? `${text.slice(0, 47)}...` : text
      await this.renameThread(threadId, title)
    }
    if (this.agentService.getSession(threadId)?.toSummary().activeRunId || sessionRuntime.isRunning()) {
      const inputId = this.agentService.steerRun(threadId, input.content, input.streamingBehavior === 'followUp' ? 'follow-up' : 'steer')
      try {
        await sessionRuntime.sendMessage({
          ...input,
          streamingBehavior: input.streamingBehavior ?? 'steer',
        })
      } catch (error) {
        this.agentService.discardPendingInputs(threadId, inputId)
        throw error
      }
      return
    }

    const runInput = {
      prompt: input.content,
      ...(context ? { context } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    }
    const handle = this.agentService.startRun(threadId, runInput)
    this.contextAttachments.release(uniqueContextAttachmentIds)
    void handle.completion.catch((error) => console.error('[PiClientService] run failed:', error))
  }

  async cancelRun(threadId: string): Promise<void> {
    this.agentService.abortSession?.(threadId)
    await this.sessionRuntimeManager.get(threadId)?.cancel()
  }

  async clearQueue(threadId: string): Promise<{ steering: string[]; followUp: string[] }> {
    const queue = this.sessionRuntimeManager.get(threadId)?.clearQueue() ?? { steering: [], followUp: [] }
    this.agentService.discardPendingInputs(threadId)
    return queue
  }

  async getAvailableModels(input?: { workspacePath?: string }): Promise<PiModelInfo[]> {
    void input?.workspacePath
    const firstRuntime = (await this.agentService.listSessions())
      .map((session) => this.sessionRuntimeManager.get(session.id))
      .find((runtime) => runtime !== undefined)
    if (firstRuntime) return firstRuntime.getAvailableModels()

    const config = this.configStore.get()
    const { provider, modelID, thinkingLevel } = getActiveModel(config)
    const catalogModel = mergeConfiguredProvidersIntoCatalog(
      mergeSavedModelsIntoCatalog(getModelCatalog(), getSavedModels(config)),
      getConfiguredProviders(config),
    )
      .find((item) => item.id === provider)
      ?.models.find((item) => item.id === modelID)
    return [
      {
        provider,
        modelId: modelID,
        name: catalogModel?.name ?? modelID,
        supportsThinking: catalogModel?.reasoning ?? thinkingLevel !== 'off',
        availableThinkingLevels: catalogModel?.availableThinkingLevels?.map(
          (level) => level as PiThinkingLevel,
        ),
      },
    ]
  }

  async setModel(threadId: string, input: { provider: string; modelId: string }): Promise<void> {
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()
    await sessionRuntime.setModel(input)
  }

  async setThinkingLevel(threadId: string, level: PiThinkingLevel): Promise<void> {
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()
    sessionRuntime.setThinkingLevel(level)
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    await this.agentService.renameSession(threadId, title)
    this.sessionRuntimeManager.get(threadId)?.setSessionName(title)
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.agentService.setSessionArchived(threadId, true)
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.agentService.setSessionArchived(threadId, false)
  }

  async deleteThread(threadId: string): Promise<void> {
    const relay = this.relays.get(threadId)
    if (relay) this.disposeRelay(relay)
    this.relays.delete(threadId)
    await this.agentService.deleteSession(threadId)
    this.sessionRuntimeManager.delete(threadId)
  }

  async respondToHostUiRequest(threadId: string, response: PiExtensionUiResponse): Promise<void> {
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()
    this.sessionRuntimeManager.respondToExtensionUiRequest(threadId, response)
  }

  subscribe(
    threadId: string,
    listener: Listener,
    options?: { includeSnapshot?: boolean },
  ): () => void {
    let active = true
    let relay: Relay
    const bufferedEvents: PiClientEvent[] = []
    let snapshotDelivered = options?.includeSnapshot === false
    const relayListener: Listener = (event) => {
      if (snapshotDelivered) this.notify(listener, event)
      else bufferedEvents.push(event)
    }
    try {
      relay = this.ensureRelay(threadId)
      relay.listeners.add(relayListener)
      relay.ready ??= (async () => {
        await relay.sessionRuntime.initialize()
        await relay.sessionRuntime.applyConfiguredModelSelection()
      })()
    } catch (error) {
      this.notify(listener, {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
        threadId,
        seq: 0,
      })
      return () => undefined
    }
    void relay.ready
      .then(() => {
        if (!active) return
        if (options?.includeSnapshot !== false) {
          const session = this.requireSession(threadId)
          const snapshotSeq = relay.seq
          const snapshot = relay.sessionRuntime.getSnapshot(this.metadataOf(session))
          this.notify(listener, { type: 'snapshot', snapshot, threadId, seq: snapshotSeq })
          snapshotDelivered = true
          for (const event of bufferedEvents) {
            if (!active) break
            if (event.seq > snapshotSeq) this.notify(listener, event)
          }
          bufferedEvents.length = 0
        }
      })
      .catch((error: unknown) => {
        relay.ready = undefined
        if (!active) return
        this.notify(listener, {
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
          threadId,
          seq: 0,
        })
      })

    return () => {
      active = false
      relay.listeners.delete(relayListener)
    }
  }

  dispose(): void {
    for (const relay of this.relays.values()) this.disposeRelay(relay)
    this.relays.clear()
  }

  private ensureRelay(threadId: string): Relay {
    const existing = this.relays.get(threadId)
    if (existing) return existing

    this.requireSession(threadId)
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    const relay: Relay = {
      sessionRuntime,
      listeners: new Set(),
      unsubscribe: () => undefined,
      seq: 0,
      pendingUpdates: new Map(),
    }
    relay.unsubscribe = sessionRuntime.subscribeClientEvents((body) =>
      this.emit(threadId, relay, body),
    )
    this.relays.set(threadId, relay)
    return relay
  }

  private emit(threadId: string, relay: Relay, body: PiClientEventBody): void {
    if (body.type === 'message_update' || body.type === 'tool_execution_update') {
      if (!relay.listeners.size) return
      const key = body.type === 'message_update' ? 'message' : `tool:${body.toolCallId}`
      relay.pendingUpdates.set(key, body)
      relay.flushTimer ??= setTimeout(() => this.flushUpdates(threadId, relay), 32)
      relay.flushTimer.unref()
      return
    }
    this.flushUpdates(threadId, relay)
    this.publishEvent(threadId, relay, body)
  }

  private flushUpdates(threadId: string, relay: Relay): void {
    clearTimeout(relay.flushTimer)
    relay.flushTimer = undefined
    const updates = [...relay.pendingUpdates.values()]
    relay.pendingUpdates.clear()
    for (const body of updates) this.publishEvent(threadId, relay, body)
  }

  private disposeRelay(relay: Relay): void {
    clearTimeout(relay.flushTimer)
    relay.pendingUpdates.clear()
    relay.unsubscribe()
  }

  private publishEvent(threadId: string, relay: Relay, body: PiClientEventBody): void {
    relay.seq += 1
    const event = { ...body, threadId, seq: relay.seq } as PiClientEvent
    for (const listener of relay.listeners) this.notify(listener, event)

    if (
      body.type === 'message_end' &&
      (body.message.role === 'user' || body.message.role === 'assistant')
    ) {
      const session = this.agentService.getSession(threadId)
      if (!session) return
      const snapshot = relay.sessionRuntime.getSnapshot(this.metadataOf(session.toSummary()))
      void Promise.resolve(this.messageProjection.project(threadId, snapshot.messages)).catch(
        (error) => {
          console.error('[PiClientService] failed to project messages:', error)
        },
      )
    }
  }

  private metadataOf(session: AgentSessionSummary): PiThreadMetadata {
    return {
      id: session.id,
      title: session.title,
      status: session.activeRunId ? 'running' : 'idle',
      archived: session.archived,

      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      runningRunId: session.activeRunId,
    }
  }

  private requireSession(threadId: string): AgentSessionSummary {
    const session = this.agentService.getSession(threadId)
    if (!session) throw new Error(`AgentSession not found: ${threadId}`)
    return session.toSummary()
  }

  private notify(listener: Listener, event: PiClientEvent): void {
    try {
      listener(event)
    } catch (error) {
      console.error('[PiClientService] listener failed:', error)
    }
  }
}
