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
  PiTranscriptMessage,
} from '@assistant-ui/react-pi/node'

import type { ArtifactService } from '@/main/artifact/artifactService'
import type { Artifact } from '@/shared/artifact/artifact'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
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
}

export class PiClientService implements PiClient {
  private readonly relays = new Map<string, Relay>()
  private readonly pendingRuns = new Set<string>()
  private readonly unsubscribeAgentEvents: () => void

  constructor(
    private readonly agentService: AgentService,
    private readonly sessionRuntimeManager: PiSessionRuntimeManager,
    private readonly messageProjection: MessageProjectionService,
    private readonly configStore: AgentConfigStore,
    private readonly artifactService: ArtifactService,
  ) {
    this.unsubscribeAgentEvents = agentService.subscribe((envelope) => {
      if (envelope.event.type !== 'artifact_created') return
      this.emitArtifact(envelope.sessionId, envelope.event.artifact, envelope.timestamp)
    })
  }

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
    const session = this.requireSession(threadId)
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()
    const snapshot = await this.withArtifacts(sessionRuntime.getSnapshot(this.metadataOf(session)))
    await this.messageProjection.project(threadId, snapshot.messages)
    return snapshot
  }

  async sendMessage(threadId: string, input: PiSendMessageInput): Promise<void> {
    const session = this.requireSession(threadId)
    if (input.attachments?.length) {
      throw new Error('Image attachments are not enabled for this agent')
    }

    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()
    if (session.title === 'New Task') {
      const text = input.content.trim()
      const title = !text ? 'New Task' : text.length > 50 ? `${text.slice(0, 47)}...` : text
      await this.renameThread(threadId, title)
    }
    if (this.pendingRuns.has(threadId) || sessionRuntime.isRunning()) {
      this.agentService.steerRun(threadId, input.content)
      await sessionRuntime.sendMessage({
        ...input,
        streamingBehavior: input.streamingBehavior ?? 'steer',
      })
      return
    }

    this.pendingRuns.add(threadId)
    try {
      const handle = this.agentService.startRun(threadId, input.content)
      void handle.completion.then(
        () => this.pendingRuns.delete(threadId),
        () => this.pendingRuns.delete(threadId),
      )
    } catch (error) {
      this.pendingRuns.delete(threadId)
      throw error
    }
  }

  async cancelRun(threadId: string): Promise<void> {
    await this.sessionRuntimeManager.get(threadId)?.cancel()
  }

  async clearQueue(threadId: string): Promise<{ steering: string[]; followUp: string[] }> {
    return this.sessionRuntimeManager.get(threadId)?.clearQueue() ?? { steering: [], followUp: [] }
  }

  async getAvailableModels(input?: { workspacePath?: string }): Promise<PiModelInfo[]> {
    void input?.workspacePath
    const firstRuntime = (await this.agentService.listSessions())
      .map((session) => this.sessionRuntimeManager.get(session.id))
      .find((runtime) => runtime !== undefined)
    if (firstRuntime) return firstRuntime.getAvailableModels()

    const { provider, modelID, thinkingLevel } = this.configStore.get().model
    return [
      { provider, modelId: modelID, name: modelID, supportsThinking: thinkingLevel !== 'off' },
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
    relay?.unsubscribe()
    this.relays.delete(threadId)
    await this.agentService.deleteSession(threadId)
    this.sessionRuntimeManager.delete(threadId)
  }

  async respondToHostUiRequest(
    threadId: string,
    response: PiExtensionUiResponse,
  ): Promise<void> {
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    await sessionRuntime.initialize()
    sessionRuntime.respondToExtensionUiRequest(response)
  }

  subscribe(
    threadId: string,
    listener: Listener,
    options?: { includeSnapshot?: boolean },
  ): () => void {
    let active = true
    let relay: Relay | undefined
    const bufferedEvents: PiClientEvent[] = []
    let snapshotDelivered = options?.includeSnapshot === false
    const relayListener: Listener = (event) => {
      if (snapshotDelivered) this.notify(listener, event)
      else bufferedEvents.push(event)
    }
    void this.ensureRelay(threadId).then(
      async (resolved) => {
        if (!active) return
        relay = resolved
        relay.listeners.add(relayListener)
        if (options?.includeSnapshot !== false) {
          const session = this.requireSession(threadId)
          const snapshotSeq = relay.seq
          const snapshot = await this.withArtifacts(
            relay.sessionRuntime.getSnapshot(this.metadataOf(session)),
          )
          if (!active) {
            relay.listeners.delete(relayListener)
            return
          }
          await this.messageProjection.project(threadId, snapshot.messages)
          this.notify(listener, { type: 'snapshot', snapshot, threadId, seq: snapshotSeq })
          snapshotDelivered = true
          for (const event of bufferedEvents) this.notify(listener, event)
          bufferedEvents.length = 0
        }
      },
      (error: unknown) => {
        if (!active) return
        this.notify(listener, {
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
          threadId,
          seq: 0,
        })
      },
    )

    return () => {
      active = false
      relay?.listeners.delete(relayListener)
    }
  }

  dispose(): void {
    this.unsubscribeAgentEvents()
    for (const relay of this.relays.values()) relay.unsubscribe()
    this.relays.clear()
  }

  private emitArtifact(threadId: string, artifact: Artifact, timestamp: number): void {
    const relay = this.relays.get(threadId)
    if (!relay) return
    const message = this.artifactMessage(artifact, timestamp)
    this.emit(threadId, relay, { type: 'message_start', message })
    this.emit(threadId, relay, { type: 'message_end', message })
  }

  private async withArtifacts(snapshot: PiThreadSnapshot): Promise<PiThreadSnapshot> {
    const artifacts = await this.artifactService.list(snapshot.metadata.id)
    if (!artifacts.length) return snapshot
    const messages = [
      ...snapshot.messages.map((message, index) => ({ message, index, artifact: false })),
      ...artifacts.map((artifact, index) => ({
        message: this.artifactMessage(artifact, artifact.createdAt),
        index,
        artifact: true,
      })),
    ]
      .sort((a, b) => {
        const timeA = typeof a.message.timestamp === 'number' ? a.message.timestamp : 0
        const timeB = typeof b.message.timestamp === 'number' ? b.message.timestamp : 0
        return timeA - timeB || Number(a.artifact) - Number(b.artifact) || a.index - b.index
      })
      .map(({ message }) => message)
    return { ...snapshot, messages }
  }

  private artifactMessage(artifact: Artifact, timestamp: number): PiTranscriptMessage {
    return {
      role: 'custom',
      customType: 'artifact',
      content: '',
      display: true,
      details: artifact,
      timestamp,
    }
  }

  private async ensureRelay(threadId: string): Promise<Relay> {
    const existing = this.relays.get(threadId)
    if (existing) return existing

    this.requireSession(threadId)
    const sessionRuntime = this.sessionRuntimeManager.getOrCreate(threadId)
    const relay: Relay = {
      sessionRuntime,
      listeners: new Set(),
      unsubscribe: () => undefined,
      seq: 0,
    }
    relay.unsubscribe = sessionRuntime.subscribeClientEvents((body) =>
      this.emit(threadId, relay, body),
    )
    this.relays.set(threadId, relay)
    await sessionRuntime.initialize()
    return relay
  }

  private emit(threadId: string, relay: Relay, body: PiClientEventBody): void {
    relay.seq += 1
    const event = { ...body, threadId, seq: relay.seq } as PiClientEvent
    for (const listener of relay.listeners) this.notify(listener, event)

    if (body.type === 'message_end') {
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
      workspacePath: this.configStore.get().cwd,
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
