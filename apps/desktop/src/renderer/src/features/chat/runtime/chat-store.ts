import type {
  AppendMessage,
  ExternalStoreThreadListAdapter,
  ThreadMessageLike,
} from '@assistant-ui/react'
import type { ExternalThreadQueueAdapter } from '@assistant-ui/react'
import type { QueueItemState } from '@assistant-ui/react'
import type { PermissionMode } from '@kklyeenook/shared/approval/permission'
import type { BotInput, BotProfile, BotSummary } from '@kklyeenook/shared/bot/bot'
import type { BotMessage, BotTask, BotReceptionPolicy } from '@kklyeenook/shared/bot/grove'
import type { NetworkBotIdentity } from '@kklyeenook/shared/bot/social'
import { decodeBotMentions, validateBotMentions, type BotMention, type MentionTarget } from '@kklyeenook/shared/bot/mentions'
import { botState } from '@kklyeenook/shared/bot/bot-state'
import type { BotState } from '@kklyeenook/shared/bot/bot'
import type { Workspace } from '@kklyeenook/shared/workspace/workspace'
import type {
  AgentFrame,
  AgentQueueMutation,
  AgentSubmissionInput,
  AgentThreadSnapshot,
  AgentThreadSummary,
} from '@kklyeenook/shared/agent/chat-protocol'
import {
  emptyDurableProjectionState,
  projectDurableThread,
  reduceDurableFrame,
  type AgentProjectedThread,
  type AgentProjectionState,
} from '@kklyeenook/shared/agent/projection'
import {
  restorePendingContextAttachmentIds,
  takePendingContextAttachmentIds,
} from '../context/pendingContextAttachments'
import { notifyWorkspaceChanged } from '../../workspaces/WorkspaceProvider'

import type { Message, ModelThinkingLevel } from '@earendil-works/pi-ai'

type Listener = () => void

class AgentRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type SendingState = { creating: boolean; threads: Set<string> }

type CreateOptions = {
  botId?: string
  workspaceId?: string | null
  permissionMode?: PermissionMode | null
  title?: string
}

export type ChatExtras = {
  state: { messages: readonly Message[] }
  metadata: {
    id: string
    config?: { provider?: string; modelId?: string; thinkingLevel?: ModelThinkingLevel }
  }
  queue: AgentProjectedThread['queue']
  contextUsage: AgentProjectedThread['contextUsage']
  compaction: AgentProjectedThread['compaction']
  refresh(): Promise<void>
  clearQueue(): Promise<void>
  setModel(input: {
    provider: string
    modelId: string
    thinkingLevel?: ModelThinkingLevel
  }): Promise<void>
  setThinkingLevel(level: ModelThinkingLevel): Promise<void>
  updateQueue(input: AgentQueueMutation): Promise<void>
  respondToApproval(id: string, approved: boolean): Promise<void>
}

export type ChatSnapshot = {
  bots: readonly BotSummary[]
  selectedBotId?: string
  botEditorId?: string
  selectedThreadId?: string
  threads: readonly AgentThreadSummary[]
  current: {
    state: BotState
    messages: readonly ThreadMessageLike[]
    projected: AgentProjectedThread
    approvals: AgentProjectionState['approvals']
    loading: boolean
    metadata?: AgentThreadSummary
    error?: string
  }
  threadList: ExternalStoreThreadListAdapter
  queue: ExternalThreadQueueAdapter
  extras: ChatExtras
  sending: SendingState
}

const emptyProjected = projectDurableThread(emptyDurableProjectionState())

export class ChatStore {
  private listeners = new Set<Listener>()
  private snapshotCache: ChatSnapshot | undefined
  private connectionVersion = 0
  private endpoint: string
  private getCreateOptions: () => CreateOptions
  private threads: readonly AgentThreadSummary[] = []
  private bots: readonly BotSummary[] = []
  private selectedBotId: string | undefined
  private botEditorId: string | undefined
  private botSelectionVersion = 0
  private disposed = false
  private botTimer: ReturnType<typeof setInterval> | undefined
  private selectedThreadId: string | undefined
  private projection: AgentProjectionState = emptyDurableProjectionState()
  private projected: AgentProjectedThread = emptyProjected
  private metadata: AgentThreadSummary | undefined
  private loading = false
  private listLoading = false
  private error: string | undefined
  private source: EventSource | undefined
  private sending: SendingState = { creating: false, threads: new Set() }
  private pendingAdmission:
    | { threadId: string; fingerprint: string; input: AgentSubmissionInput }
    | undefined
  private pendingCreation: { fingerprint: string; id: string } | undefined

  constructor(baseUrl: string, getCreateOptions: () => CreateOptions, autoStart = true) {
    this.endpoint = baseUrl.replace(/\/+$/, '')
    this.getCreateOptions = getCreateOptions
    if (autoStart) this.start()
  }

  start() {
    if (this.botTimer) return
    this.disposed = false
    void (this.selectedThreadId ? this.refresh() : this.initialize()).catch((error) => {
      this.error = error instanceof Error ? error.message : 'Chat load failed'
      this.emit()
    })
    this.botTimer = setInterval(() => {
      void this.reloadBots().catch(() => undefined)
    }, 2000)
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ChatSnapshot => (this.snapshotCache ??= this.buildSnapshot())

  private buildSnapshot = (): ChatSnapshot => ({
    bots: this.bots,
    selectedBotId: this.selectedBotId,
    botEditorId: this.botEditorId,
    selectedThreadId: this.selectedThreadId,
    threads: this.threads,
    current: {
      state: this.projection.snapshot
        ? botState(
            this.projection.snapshot,
            this.projection.approvals.some((approval) => approval.state === 'pending'),
          )
        : 'idle',
      messages: this.projected.messages,
      projected: this.projected,
      approvals: this.projection.approvals,
      loading: this.loading,
      metadata: this.metadata
        ? { ...this.metadata, ...this.projection.snapshot?.agent }
        : undefined,
      error: this.error,
    },
    threadList: this.threadListAdapter(),
    queue: this.queueAdapter(),
    extras: this.extras(),
    sending: this.sending,
  })

  dispose() {
    this.disposed = true
    clearInterval(this.botTimer)
    this.botTimer = undefined
    this.botSelectionVersion++
    this.connectionVersion++
    this.source?.close()
  }

  private async initialize() {
    await Promise.all([this.reloadThreads(), this.reloadBots()])
    if (this.disposed || this.selectedBotId || this.selectedThreadId) return
    const bot = this.bots.find((bot) => bot.id === 'xiaoya') ?? this.bots[0]
    if (bot) await this.selectBot(bot.id)
  }

  async reloadBots() {
    const bots = await this.request<BotSummary[]>('/bots')
    if (this.disposed) return
    this.bots = bots
    this.emit()
  }

  editBot(id?: string) {
    this.botEditorId = id
    this.emit()
  }

  async selectBot(id: string) {
    const version = ++this.botSelectionVersion
    this.connectionVersion++
    this.source?.close()
    this.source = undefined
    this.selectedThreadId = undefined
    this.metadata = undefined
    this.projection = emptyDurableProjectionState()
    this.projected = emptyProjected
    this.selectedBotId = id
    this.botEditorId = undefined
    this.loading = true
    this.error = undefined
    this.emit()
    try {
      const thread = await this.request<AgentThreadSummary>(
        `/bots/${encodeURIComponent(id)}/main-thread`,
        { method: 'POST' },
      )
      if (this.disposed || version !== this.botSelectionVersion) return
      this.threads = [thread, ...this.threads.filter((item) => item.id !== thread.id)]
      await this.switchToThread(thread.id, true)
    } catch (error) {
      if (version !== this.botSelectionVersion || this.disposed) return
      this.loading = false
      this.error = error instanceof Error ? error.message : 'Bot load failed'
      this.emit()
      throw error
    }
  }

  botOptions() {
    return this.request<{
      workspaces: Workspace[]
      tools: { name: string; description: string }[]
    }>('/bot-options')
  }

  grove() {
    return this.request<{ messages: BotMessage[]; tasks: BotTask[]; policies: Record<string, BotReceptionPolicy>; contacts: NetworkBotIdentity[]; identities: NetworkBotIdentity[]; network: { enabled: boolean; error?: string } }>('/grove')
  }
  mentionTargets() {
    if (!this.selectedThreadId) return Promise.resolve<MentionTarget[]>([])
    return this.request<MentionTarget[]>(`/grove/mention-targets?threadId=${encodeURIComponent(this.selectedThreadId)}`)
  }

  setGrovePolicy(botId: string, policy: BotReceptionPolicy) {
    return this.request(`/grove/policies/${encodeURIComponent(botId)}`, { method: 'PUT', body: policy })
  }

  async collaborate(toBotId: string, content: string, type: 'tasks' | 'messages', operationId: string) {
    if (!this.selectedThreadId) throw new Error('请先选择发起协作的 Bot 会话')
    return this.request(`/grove/${type}`, {
      method: 'POST', body: {
        threadId: this.selectedThreadId, toBotId, operationId,
        ...(type === 'tasks' ? { instruction: content } : { content }),
      },
    })
  }

  async saveBot(input: BotInput, id?: string) {
    const profile = await this.request<BotProfile>(
      id ? `/bots/${encodeURIComponent(id)}` : '/bots',
      { method: id ? 'PATCH' : 'POST', body: input },
    )
    await this.reloadBots()
    this.editBot(profile.id)
    return profile
  }

  async duplicateBot(id: string) {
    const bot = await this.request<BotProfile>(`/bots/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
    })
    await this.reloadBots()
    this.editBot(bot.id)
  }

  async resetBot(id: string) {
    await this.request(`/bots/${encodeURIComponent(id)}/reset`, { method: 'POST' })
    await this.reloadBots()
  }

  async deleteBot(id: string) {
    await this.request(`/bots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: { strategy: 'archive-conversations' },
    })
    await Promise.all([this.reloadBots(), this.reloadThreads()])
    this.editBot(undefined)
    if (this.selectedBotId === id) await this.selectBot('xiaoya')
  }

  async setWorkspace(workspaceId: string | null) {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}`, {
      method: 'PATCH',
      body: { workspaceId },
    })
    await this.refresh()
    await this.reloadThreads()
    notifyWorkspaceChanged()
  }

  async reloadThreads() {
    this.listLoading = true
    this.emit()
    try {
      this.threads = await this.request<AgentThreadSummary[]>('/threads')
      const selected = this.threads.find((thread) => thread.id === this.selectedThreadId)
      if (selected && this.metadata) this.metadata = { ...this.metadata, ...selected }
      if (
        this.selectedThreadId &&
        !this.threads.some((thread) => thread.id === this.selectedThreadId)
      ) {
        if (this.selectedBotId) await this.selectBot(this.selectedBotId)
        else await this.switchToNewThread()
      }
    } finally {
      this.listLoading = false
      this.emit()
    }
  }

  async switchToNewThread() {
    if (this.selectedBotId) {
      await this.createThread({ botId: this.selectedBotId })
      return
    }
    this.connectionVersion++
    this.source?.close()
    this.source = undefined
    this.selectedThreadId = undefined
    this.projection = emptyDurableProjectionState()
    this.projected = emptyProjected
    this.metadata = undefined
    this.loading = false
    this.error = undefined
    this.emit()
  }

  async switchToThread(threadId: string, force = false) {
    if (this.selectedThreadId === threadId && !this.loading && !force) return
    const version = ++this.connectionVersion
    this.botSelectionVersion++
    this.source?.close()
    this.source = undefined
    this.selectedThreadId = threadId
    this.projection = emptyDurableProjectionState()
    this.projected = emptyProjected
    this.metadata = undefined
    this.loading = true
    this.error = undefined
    this.emit()
    try {
      const value = await this.request<AgentThreadSnapshot>(
        `/threads/${encodeURIComponent(threadId)}`,
      )
      if (this.selectedThreadId !== threadId || version !== this.connectionVersion) return
      this.metadata = value.metadata ?? this.threads.find((thread) => thread.id === threadId)
      this.selectedBotId = this.metadata?.botId ?? this.selectedBotId
      this.botEditorId = undefined
      this.projection = {
        snapshot: value.snapshot,
        contextWindow: value.contextWindow,
        approvals: value.approvals,
        queue: value.queue,
        sequence: 0,
      }
      this.projected = projectDurableThread(this.projection)
      this.loading = false
      this.emit()
      this.connect(threadId)
    } catch (error) {
      if (this.selectedThreadId !== threadId || version !== this.connectionVersion) return
      this.loading = false
      this.error = error instanceof Error ? error.message : 'Conversation load failed'
      this.emit()
    }
  }

  async createThread(options: CreateOptions = {}) {
    const selectionVersion = this.botSelectionVersion
    const bot = this.bots.find((bot) => bot.id === (options.botId ?? this.selectedBotId))
    const input = {
      ...(bot
        ? { botId: bot.id, workspaceId: bot.defaultWorkspaceId, permissionMode: bot.permissionMode }
        : this.getCreateOptions()),
      ...options,
    }
    const fingerprint = JSON.stringify(input)
    const creation =
      this.pendingCreation?.fingerprint === fingerprint
        ? this.pendingCreation
        : { fingerprint, id: crypto.randomUUID() }
    this.pendingCreation = creation
    this.setSending(undefined, true)
    try {
      const created = await this.request<AgentThreadSummary>('/threads', {
        method: 'POST',
        body: {
          threadId: creation.id,
          botId: input.botId,
          title: input.title,
          workspaceId: input.workspaceId ?? undefined,
          permissionMode: input.permissionMode ?? undefined,
        },
      })
      if (this.pendingCreation === creation) this.pendingCreation = undefined
      this.threads = [created, ...this.threads.filter((thread) => thread.id !== created.id)]
      if (!this.disposed && selectionVersion === this.botSelectionVersion)
        await this.switchToThread(created.id)
      notifyWorkspaceChanged()
      return created.id
    } catch (error) {
      if (
        error instanceof AgentRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        this.pendingCreation === creation
      )
        this.pendingCreation = undefined
      throw error
    } finally {
      this.setSending(undefined, false)
    }
  }

  async submit(message: AppendMessage, whenBusy?: 'steer' | 'followUp' | 'reject') {
    if (!this.selectedThreadId && this.selectedBotId) await this.selectBot(this.selectedBotId)
    const threadId = this.selectedThreadId ?? (await this.createThread())
    const pendingIds = takePendingContextAttachmentIds()
    const botMentions: BotMention[] = []
    let textLength = 0
    const rawContent = agentContent(message)
    const parts = (typeof rawContent === 'string' ? [{ type: 'text' as const, text: rawContent }] : rawContent).map((part) => {
      if (part.type !== 'text') return part
      const decoded = decodeBotMentions(part.text)
      botMentions.push(...decoded.mentions.map((mention) => ({ ...mention, start: mention.start + textLength, end: mention.end + textLength })))
      textLength += decoded.text.length + 1
      return { ...part, text: decoded.text }
    })
    try { validateBotMentions(parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n'), botMentions) }
    catch (error) { restorePendingContextAttachmentIds(pendingIds); throw error }
    const intent = {
      type: 'input' as const,
      content: typeof rawContent === 'string' ? (parts[0] as { type: 'text'; text: string }).text : parts,
      ...(botMentions.length ? { botMentions } : {}),
      ...(pendingIds.length ? { contextAttachmentIds: pendingIds } : {}),
    }
    const fingerprint = JSON.stringify(intent)
    const admission =
      this.pendingAdmission?.threadId === threadId &&
      this.pendingAdmission.fingerprint === fingerprint
        ? this.pendingAdmission
        : { threadId, fingerprint, input: { ...intent, requestId: crypto.randomUUID(), whenBusy } }
    this.pendingAdmission = admission
    this.setSending(threadId, true)
    try {
      await this.request(`/threads/${encodeURIComponent(threadId)}/submissions`, {
        method: 'POST',
        body: admission.input,
      })
      if (this.pendingAdmission === admission) this.pendingAdmission = undefined
      notifyWorkspaceChanged()
      void this.reloadThreads().catch(() => undefined)
    } catch (error) {
      if (
        error instanceof AgentRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        this.pendingAdmission === admission
      )
        this.pendingAdmission = undefined
      restorePendingContextAttachmentIds(pendingIds)
      throw error
    } finally {
      this.setSending(threadId, false)
    }
  }

  async cancel() {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/cancel`, {
      method: 'POST',
    })
  }

  async refresh() {
    if (this.selectedThreadId) await this.switchToThread(this.selectedThreadId, true)
    else await this.reloadThreads()
  }

  async rename(threadId: string, title: string) {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: { title },
    })
    this.threads = this.threads.map((thread) =>
      thread.id === threadId ? { ...thread, title } : thread,
    )
    if (this.metadata?.id === threadId) this.metadata = { ...this.metadata, title }
    this.emit()
    notifyWorkspaceChanged()
  }

  async archive(threadId: string, archived: boolean) {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: { archived },
    })
    this.threads = this.threads.map((thread) =>
      thread.id === threadId ? { ...thread, archived } : thread,
    )
    this.emit()
    notifyWorkspaceChanged()
  }

  async delete(threadId: string) {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
    this.threads = this.threads.filter((thread) => thread.id !== threadId)
    if (this.selectedThreadId === threadId) {
      if (this.selectedBotId) await this.selectBot(this.selectedBotId)
      else await this.switchToNewThread()
    }
    this.emit()
    notifyWorkspaceChanged()
  }

  async setModel(input: { provider: string; modelId: string; thinkingLevel?: ModelThinkingLevel }) {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/model`, {
      method: 'POST',
      body: input,
    })
    this.patchMetadata({
      model: { provider: input.provider, modelId: input.modelId },
      thinkingLevel: input.thinkingLevel,
    })
    await this.reloadBots()
  }

  async setThinkingLevel(level: ModelThinkingLevel) {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/thinking`, {
      method: 'POST',
      body: { level },
    })
    this.patchMetadata({ thinkingLevel: level })
    await this.reloadBots()
  }

  async clearQueue() {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/queue/clear`, {
      method: 'POST',
    })
  }

  async updateQueue(input: AgentQueueMutation) {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/queue/item`, {
      method: 'POST',
      body: input,
    })
  }

  async respondToApproval(approvalId: string, approved: boolean) {
    if (!this.selectedThreadId) return
    await this.request(
      `/threads/${encodeURIComponent(this.selectedThreadId)}/approvals/${encodeURIComponent(approvalId)}`,
      { method: 'POST', body: { state: approved ? 'approved' : 'rejected' } },
    )
  }

  private connect(threadId: string) {
    this.source?.close()
    const source = new EventSource(
      `${this.endpoint}/threads/${encodeURIComponent(threadId)}/events`,
    )
    this.source = source
    source.onmessage = (message) => {
      if (this.selectedThreadId !== threadId || this.source !== source) return
      try {
        const frame = JSON.parse(message.data) as AgentFrame
        if (frame.threadId !== threadId) return
        const next = reduceDurableFrame(this.projection, frame)
        if (next === this.projection) return
        this.projection = next
        this.projected = projectDurableThread(this.projection)
        this.error = undefined
        this.loading = false
        this.emit()
      } catch {
        this.error = 'Event stream interrupted. Reconnecting…'
        this.emit()
        this.connect(threadId)
      }
    }
    source.onerror = () => {
      if (this.selectedThreadId !== threadId || this.source !== source) return
      this.error = 'Connection lost. Reconnecting…'
      this.emit()
    }
  }

  private threadListAdapter(): ExternalStoreThreadListAdapter {
    const regular = this.threads.filter((thread) => !thread.archived)
    const archived = this.threads.filter((thread) => thread.archived)
    return {
      threadId: this.selectedThreadId,
      isLoading: this.listLoading,
      threads: regular.map(toThreadData),
      archivedThreads: archived.map((thread) => ({
        ...toThreadData(thread),
        status: 'archived' as const,
      })),
      onSwitchToNewThread: () => this.switchToNewThread(),
      onSwitchToThread: (threadId) => this.switchToThread(threadId),
      onRename: (threadId, title) => this.rename(threadId, title),
      onArchive: (threadId) => this.archive(threadId, true),
      onUnarchive: (threadId) => this.archive(threadId, false),
      onDelete: (threadId) => this.delete(threadId),
    }
  }

  private queueAdapter(): ExternalThreadQueueAdapter {
    const followUp = this.queueItems('followUp')
    const steer = this.queueItems('steer')
    return {
      items: followUp,
      steerItems: steer,
      enqueue: (message) => {
        void this.submit(message, 'followUp')
      },
      steer: (message) => {
        void this.submit(message, 'steer')
      },
      move: (id, placement) => {
        void this.queuePlacement(id, placement.lane === 'steer' ? 'steer' : 'followUp')
      },
      edit: (id, message) => {
        void this.queueEdit(id, message)
      },
      remove: (id) => {
        void this.queueRemove(id)
      },
    }
  }

  private extras(): ChatExtras {
    const id = this.selectedThreadId ?? ''
    const config = {
      provider: this.projection.snapshot?.agent.model?.provider ?? this.metadata?.model?.provider,
      modelId: this.projection.snapshot?.agent.model?.modelId ?? this.metadata?.model?.modelId,
      thinkingLevel: this.projection.snapshot?.agent.thinkingLevel ?? this.metadata?.thinkingLevel,
    }
    return {
      state: { messages: this.projected.transcript },
      metadata: { id, config },
      queue: this.projected.queue,
      contextUsage: this.projected.contextUsage,
      compaction: this.projected.compaction,
      refresh: () => this.refresh(),
      clearQueue: () => this.clearQueue(),
      setModel: (input) => this.setModel(input),
      setThinkingLevel: (level) => this.setThinkingLevel(level),
      updateQueue: (input) => this.updateQueue(input),
      respondToApproval: (id, approved) => this.respondToApproval(id, approved),
    }
  }

  private queueItems(mode: 'steer' | 'followUp'): QueueItemState[] {
    return this.projection.queue
      .filter((item) => item.mode === mode)
      .map((item, index) => ({
        id: `${mode}:${item.id}`,
        prompt: queueItemText(item),
        parts: [{ type: 'text', text: queueItemText(item) }],
        index,
      }))
  }

  private async queueRemove(id: string) {
    const parsed = this.parseQueueId(id)
    if (!parsed) return
    await this.updateQueue({
      mode: parsed.mode,
      expected: parsed.expected,
      index: parsed.index,
      action: 'remove',
    })
  }

  private async queueEdit(id: string, message: AppendMessage) {
    const parsed = this.parseQueueId(id)
    if (!parsed) return
    await this.updateQueue({
      mode: parsed.mode,
      expected: parsed.expected,
      index: parsed.index,
      action: 'edit',
      value: agentText(message),
    })
  }

  private async queuePlacement(id: string, mode: 'steer' | 'followUp') {
    const parsed = this.parseQueueId(id)
    if (!parsed) return
    await this.updateQueue({
      mode: parsed.mode,
      expected: parsed.expected,
      index: parsed.index,
      action: mode === 'steer' ? 'steer' : 'move',
      value: parsed.index,
    })
  }

  private parseQueueId(id: string) {
    const [mode, raw] = id.split(':') as ['steer' | 'followUp', string]
    const items = this.projection.queue.filter((item) => item.mode === mode)
    const index = items.findIndex((item) => String(item.id) === raw)
    if (index < 0) return undefined
    return { mode, index, expected: items.map(queueItemText) }
  }

  private patchMetadata(patch: Partial<AgentThreadSummary>) {
    if (!this.selectedThreadId) return
    this.metadata = { id: this.selectedThreadId, ...this.metadata, ...patch }
    this.threads = this.threads.map((thread) =>
      thread.id === this.selectedThreadId ? { ...thread, ...patch } : thread,
    )
    this.emit()
  }

  private setSending(threadId: string | undefined, pending: boolean) {
    const threads = new Set(this.sending.threads)
    if (threadId) {
      if (pending) threads.add(threadId)
      else threads.delete(threadId)
      this.sending = { ...this.sending, threads }
    } else {
      this.sending = { ...this.sending, creating: pending }
    }
    this.emit()
  }

  private async request<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new AgentRequestError(
        response.status,
        `${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
      )
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  private emit() {
    this.snapshotCache = undefined
    this.listeners.forEach((listener) => listener())
  }
}

function toThreadData(thread: AgentThreadSummary) {
  return {
    id: thread.id,
    remoteId: thread.id,
    title: thread.title,
    status: 'regular' as const,
    custom: { workspaceId: thread.workspaceId },
  }
}

function agentContent(message: AppendMessage): AgentSubmissionInput['content'] {
  const parts = [
    ...message.content,
    ...(message.attachments?.flatMap((attachment) => attachment.content) ?? []),
  ]
    .map((part) => {
      if (part.type === 'text') return { type: 'text' as const, text: part.text }
      if (part.type === 'image' && typeof part.image === 'string') {
        const match = /^data:([^;,]+);base64,(.*)$/i.exec(part.image)
        return {
          type: 'image' as const,
          data: match?.[2] ?? part.image,
          mimeType: match?.[1] ?? 'image/png',
        }
      }
      return undefined
    })
    .filter(
      (
        part,
      ): part is
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string } => Boolean(part),
    )
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  return parts
}

function agentText(message: AppendMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function queueItemText(item: { content?: unknown; entry?: unknown }): string {
  const content = item.content
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map((part) => (part?.type === 'text' ? part.text : '[image]')).join('\n')
  return ''
}
