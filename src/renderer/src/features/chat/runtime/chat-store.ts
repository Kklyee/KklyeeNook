import type { AppendMessage, ExternalStoreThreadListAdapter, ThreadMessageLike } from '@assistant-ui/react'
import type { ExternalThreadQueueAdapter } from '@assistant-ui/react'
import type { QueueItemState } from '@assistant-ui/react'
import type { PermissionMode } from '@/shared/approval/permission'
import type {
  AgentFrame,
  AgentQueueMutation,
  AgentSubmissionInput,
  AgentThreadSnapshot,
  AgentThreadSummary,
} from '@/shared/agent/chat-protocol'
import {
  emptyDurableProjectionState,
  projectDurableThread,
  reduceDurableFrame,
  type AgentProjectedThread,
  type AgentProjectionState,
} from '@kklyeenook/shared/agent/projection'
import { projectHistory } from '@kklyeenook/shared/agent/history'
import {
  restorePendingContextAttachmentIds,
  takePendingContextAttachmentIds,
} from '../context/pendingContextAttachments'
import { notifyWorkspaceChanged } from '../../workspaces/WorkspaceProvider'

import type { Message, ModelThinkingLevel } from '@earendil-works/pi-ai'

type Listener = () => void

type SendingState = { creating: boolean; threads: Set<string> }

type CreateOptions = {
  workspaceId?: string | null
  permissionMode?: PermissionMode | null
  title?: string
}

export type ChatExtras = {
  state: { messages: readonly Message[] }
  metadata: {
    id: string
    config?: { provider?: string; modelId?: string; thinkingLevel?: ModelThinkingLevel }
    historical?: boolean
  }
  queue: AgentProjectedThread['queue']
  contextUsage: AgentProjectedThread['contextUsage']
  compaction: AgentProjectedThread['compaction']
  hostUiRequests: readonly never[]
  refresh(): Promise<void>
  clearQueue(): Promise<void>
  setModel(input: { provider: string; modelId: string; thinkingLevel?: ModelThinkingLevel }): Promise<void>
  setThinkingLevel(level: ModelThinkingLevel): Promise<void>
  updateQueue(input: AgentQueueMutation): Promise<void>
  respondToApproval(id: string, approved: boolean): Promise<void>
  continueThread(): Promise<string>
  controller: { connect(): () => void; refresh(): Promise<void> }
}

export type ChatSnapshot = {
  selectedThreadId?: string
  threads: readonly AgentThreadSummary[]
  current: {
    messages: readonly ThreadMessageLike[]
    projected: AgentProjectedThread
    approvals: AgentProjectionState['approvals']
    loading: boolean
    disabled: boolean
    historical: boolean
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
  private selectedThreadId: string | undefined
  private historyMessages: readonly ThreadMessageLike[] = []
  private projection: AgentProjectionState = emptyDurableProjectionState()
  private projected: AgentProjectedThread = emptyProjected
  private metadata: AgentThreadSummary | undefined
  private historical = false
  private loading = false
  private listLoading = false
  private error: string | undefined
  private source: EventSource | undefined
  private sending: SendingState = { creating: false, threads: new Set() }
  private pendingAdmission: { threadId: string; fingerprint: string; input: AgentSubmissionInput } | undefined

  constructor(baseUrl: string, getCreateOptions: () => CreateOptions) {
    this.endpoint = baseUrl.replace(/\/+$/, '')
    this.getCreateOptions = getCreateOptions
    void this.reloadThreads()
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ChatSnapshot => this.snapshotCache ??= this.buildSnapshot()

  private buildSnapshot = (): ChatSnapshot => ({
    selectedThreadId: this.selectedThreadId,
    threads: this.threads,
    current: {
      messages: [...this.historyMessages, ...this.projected.messages],
      projected: this.projected,
      approvals: this.projection.approvals,
      loading: this.loading,
      disabled: this.historical,
      historical: this.historical,
      metadata: this.metadata ? { ...this.metadata, ...this.projection.snapshot?.agent } : undefined,
      error: this.error,
    },
    threadList: this.threadListAdapter(),
    queue: this.queueAdapter(),
    extras: this.extras(),
    sending: this.sending,
  })

  dispose() {
    this.connectionVersion++
    this.source?.close()
  }

  async reloadThreads() {
    this.listLoading = true
    this.emit()
    try {
      this.threads = await this.request<AgentThreadSummary[]>('/threads')
      if (this.selectedThreadId && !this.threads.some((thread) => thread.id === this.selectedThreadId)) {
        await this.switchToNewThread()
      }
    } finally {
      this.listLoading = false
      this.emit()
    }
  }

  async switchToNewThread() {
    this.connectionVersion++
    this.source?.close()
    this.source = undefined
    this.selectedThreadId = undefined
    this.historyMessages = []
    this.projection = emptyDurableProjectionState()
    this.projected = emptyProjected
    this.metadata = undefined
    this.historical = false
    this.loading = false
    this.error = undefined
    this.emit()
  }

  async switchToThread(threadId: string, force = false) {
    if (this.selectedThreadId === threadId && !this.loading && !force) return
    const version = ++this.connectionVersion
    this.source?.close()
    this.source = undefined
    this.selectedThreadId = threadId
    this.historyMessages = []
    this.projection = emptyDurableProjectionState()
    this.projected = emptyProjected
    this.loading = true
    this.error = undefined
    this.emit()
    try {
      const value = await this.request<AgentThreadSnapshot>(`/threads/${encodeURIComponent(threadId)}`)
      if (this.selectedThreadId !== threadId || version !== this.connectionVersion) return
      this.historyMessages = projectHistory(value.history ?? [])
      this.metadata = value.metadata ?? this.threads.find((thread) => thread.id === threadId)
      this.historical = value.historical === true || this.metadata?.historical === true
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
      if (!this.historical) this.connect(threadId)
    } catch (error) {
      if (this.selectedThreadId !== threadId || version !== this.connectionVersion) return
      this.loading = false
      this.error = error instanceof Error ? error.message : 'Conversation load failed'
      this.emit()
    }
  }

  async createThread(options: CreateOptions = {}) {
    const input = { ...this.getCreateOptions(), ...options }
    const id = crypto.randomUUID()
    this.setSending(undefined, true)
    try {
      const created = await this.request<AgentThreadSummary>('/threads', {
        method: 'POST',
        body: {
          threadId: id,
          title: input.title,
          workspaceId: input.workspaceId ?? undefined,
          permissionMode: input.permissionMode ?? undefined,
        },
      })
      this.threads = [created, ...this.threads.filter((thread) => thread.id !== created.id)]
      await this.switchToThread(created.id)
      notifyWorkspaceChanged()
      return created.id
    } finally {
      this.setSending(undefined, false)
    }
  }

  async submit(message: AppendMessage, whenBusy?: 'steer' | 'followUp' | 'reject') {
    const threadId = this.selectedThreadId ?? (await this.createThread())
    const pendingIds = takePendingContextAttachmentIds()
    const intent = { type: 'input' as const, content: agentContent(message), ...(pendingIds.length ? { contextAttachmentIds: pendingIds } : {}) }
    const fingerprint = JSON.stringify(intent)
    const admission = this.pendingAdmission?.threadId === threadId && this.pendingAdmission.fingerprint === fingerprint
      ? this.pendingAdmission
      : { threadId, fingerprint, input: { ...intent, requestId: crypto.randomUUID(), whenBusy } }
    this.pendingAdmission = admission
    this.setSending(threadId, true)
    try {
      await this.request(`/threads/${encodeURIComponent(threadId)}/submissions`, { method: 'POST', body: admission.input })
      if (this.pendingAdmission === admission) this.pendingAdmission = undefined
      notifyWorkspaceChanged()
      void this.reloadThreads().catch(() => undefined)
    } catch (error) {
      restorePendingContextAttachmentIds(pendingIds)
      throw error
    } finally {
      this.setSending(threadId, false)
    }
  }

  async cancel() {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/cancel`, { method: 'POST' })
  }

  async refresh() {
    if (this.selectedThreadId) await this.switchToThread(this.selectedThreadId, true)
    else await this.reloadThreads()
  }

  async rename(threadId: string, title: string) {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, { method: 'PATCH', body: { title } })
    this.threads = this.threads.map((thread) => (thread.id === threadId ? { ...thread, title } : thread))
    if (this.metadata?.id === threadId) this.metadata = { ...this.metadata, title }
    this.emit()
    notifyWorkspaceChanged()
  }

  async archive(threadId: string, archived: boolean) {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, { method: 'PATCH', body: { archived } })
    this.threads = this.threads.map((thread) => (thread.id === threadId ? { ...thread, archived } : thread))
    this.emit()
    notifyWorkspaceChanged()
  }

  async delete(threadId: string) {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
    this.threads = this.threads.filter((thread) => thread.id !== threadId)
    if (this.selectedThreadId === threadId) await this.switchToNewThread()
    this.emit()
    notifyWorkspaceChanged()
  }

  async setModel(input: { provider: string; modelId: string; thinkingLevel?: ModelThinkingLevel }) {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/model`, {
      method: 'POST',
      body: input,
    })
    this.patchMetadata({ model: { provider: input.provider, modelId: input.modelId }, thinkingLevel: input.thinkingLevel })
  }

  async setThinkingLevel(level: ModelThinkingLevel) {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/thinking`, {
      method: 'POST',
      body: { level },
    })
    this.patchMetadata({ thinkingLevel: level })
  }

  async clearQueue() {
    if (!this.selectedThreadId) return
    await this.request(`/threads/${encodeURIComponent(this.selectedThreadId)}/queue/clear`, { method: 'POST' })
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

  async continueThread() {
    if (!this.selectedThreadId) return this.createThread()
    const result = await this.request<AgentThreadSummary>(
      `/threads/${encodeURIComponent(this.selectedThreadId)}/continue`,
      { method: 'POST', body: { threadId: crypto.randomUUID() } },
    )
    this.threads = [result, ...this.threads.filter((thread) => thread.id !== result.id)]
    await this.switchToThread(result.id)
    notifyWorkspaceChanged()
    return result.id
  }

  private connect(threadId: string) {
    this.source?.close()
    const source = new EventSource(`${this.endpoint}/threads/${encodeURIComponent(threadId)}/events`)
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
      archivedThreads: archived.map((thread) => ({ ...toThreadData(thread), status: 'archived' as const })),
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
      enqueue: (message) => { void this.submit(message, 'followUp') },
      steer: (message) => { void this.submit(message, 'steer') },
      move: (id, placement) => { void this.queuePlacement(id, placement.lane === 'steer' ? 'steer' : 'followUp') },
      edit: (id, message) => { void this.queueEdit(id, message) },
      remove: (id) => { void this.queueRemove(id) },
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
      metadata: { id, config, historical: this.historical },
      queue: this.projected.queue,
      contextUsage: this.projected.contextUsage,
      compaction: this.projected.compaction,
      hostUiRequests: [],
      refresh: () => this.refresh(),
      clearQueue: () => this.clearQueue(),
      setModel: (input) => this.setModel(input),
      setThinkingLevel: (level) => this.setThinkingLevel(level),
      updateQueue: (input) => this.updateQueue(input),
      respondToApproval: (id, approved) => this.respondToApproval(id, approved),
      continueThread: () => this.continueThread(),
      controller: { connect: () => () => undefined, refresh: () => this.refresh() },
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
    await this.updateQueue({ mode: parsed.mode, expected: parsed.expected, index: parsed.index, action: 'remove' })
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

  private async request<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`)
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
    custom: { workspaceId: thread.workspaceId, historical: thread.historical },
  }
}

function agentContent(message: AppendMessage): AgentSubmissionInput['content'] {
  const parts = [...message.content, ...(message.attachments?.flatMap((attachment) => attachment.content) ?? [])]
    .map((part) => {
      if (part.type === 'text') return { type: 'text' as const, text: part.text }
      if (part.type === 'image' && typeof part.image === 'string') {
        const match = /^data:([^;,]+);base64,(.*)$/i.exec(part.image)
        return { type: 'image' as const, data: match?.[2] ?? part.image, mimeType: match?.[1] ?? 'image/png' }
      }
      return undefined
    })
    .filter((part): part is { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } => Boolean(part))
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  return parts
}

function agentText(message: AppendMessage): string {
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
}

function queueItemText(item: { content?: unknown; entry?: unknown }): string {
  const content = item.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => (part?.type === 'text' ? part.text : '[image]')).join('\n')
  return ''
}
