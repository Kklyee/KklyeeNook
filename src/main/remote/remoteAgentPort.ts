import { randomUUID } from 'node:crypto'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { InboxDoc, type InboxItem } from '@earendil-works/pi-durable'
import { PERMISSION_MODES, effectivePermissionMode } from '@kklyeenook/shared/approval/permission'
import type {
  RemoteApprovalResponse,
  RemoteConversationSnapshot,
  RemoteConversationSummary,
  RemoteCreateConversationInput,
  RemoteEvent,
  RemoteEventBody,
  RemoteModel,
  RemotePermissionMode,
  RemoteProject,
  RemoteQueueMutation,
  RemoteSendMessageInput,
  RemoteState,
} from '@kklyeenook/shared/remote/index'
import type { RemoteFileAttachment } from '@kklyeenook/shared/remote/index'
import type { WorkspaceService } from '../workspace/workspaceService'
import type { AgentConfigStore } from '../settings/agentConfigStore'
import type { UpdateAgentModelSelectionRequest } from '@/shared/agent/agentSettings'
import type { ThinkingLevel } from '@/shared/agent/agentConfig'
import { getAgentCompactionSettings } from '@/shared/agent/agentConfig'
import { getActiveModel } from '@/shared/agent/agentConfig'
import { getAgentModelChoices } from '../settings/model-catalog'
import type { ContextAttachmentService } from '../context/contextAttachmentService'
import { validateRemoteAttachments } from './remoteAttachments'
import { AgentHost } from '../agent/agent-host'
import { approvalSignalDoc } from '../agent/approvals'
import { runMembershipDoc } from '../agent/run-membership'
import {
  applyDurableEvent,
  contentText,
  agentApproval,
  agentQueue,
  agentRemoteSnapshot,
  agentHistoryMessages,
  agentSummary,
  emptySnapshot,
  isDurableRunning,
} from '../agent/projection'

export class RemoteError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 413, message: string) { super(message) }
}

export interface RemoteAgentPort {
  assertConversation(id: string): Promise<void>
  getState(): Promise<RemoteState>
  listProjects(): Promise<RemoteProject[]>
  getProject(id: string): Promise<RemoteProject>
  listConversations(projectId: string): Promise<RemoteConversationSummary[]>
  createConversation(projectId: string, input: RemoteCreateConversationInput): Promise<RemoteConversationSnapshot>
  getConversation(id: string): Promise<RemoteConversationSnapshot>
  continueConversation(id: string, threadId: string): Promise<RemoteConversationSnapshot>
  renameConversation(id: string, title: string): Promise<void>
  sendMessage(id: string, input: RemoteSendMessageInput): Promise<void>
  setPermission(id: string, mode: RemotePermissionMode): Promise<void>
  setModel(id: string, input: { provider: string; modelId: string }): Promise<void>
  setThinkingLevel(id: string, level: string): Promise<void>
  cancel(id: string): Promise<void>
  clearQueue(id: string): Promise<void>
  updateQueue(id: string, input: RemoteQueueMutation): Promise<void>
  respondToApproval(id: string, input: RemoteApprovalResponse): Promise<void>
  listModels(): Promise<RemoteModel[]>
  subscribe(id: string, listener: (event: RemoteEvent) => void): () => void
}

export function createRemoteAgentPort(
  workspaces: WorkspaceService,
  host: AgentHost,
  config: AgentConfigStore,
  saveModelSelection: (selection: UpdateAgentModelSelectionRequest) => void,
  contextAttachments: ContextAttachmentService,
): RemoteAgentPort {
  const requireSession = async (id: string) => {
    const session = await host.conversations.get(id, BACKGROUND_CONTEXT)
    if (!session.workspaceId) throw new RemoteError(404, 'Conversation not found')
    return session
  }
  const requireLiveSession = async (id: string) => {
    const session = await requireSession(id)
    if ('historical' in session && session.historical) throw new RemoteError(409, 'Historical conversation is read-only; continue in a new conversation')
    return session
  }
  const prepareAttachments = (files: RemoteFileAttachment[]) => {
    const ids: string[] = []
    const images: Array<{ type: 'image'; data: string; mimeType: string }> = []
    try {
      for (const file of files) {
        if (file.type === 'image') images.push({ type: 'image', mimeType: file.mimeType, data: file.data })
        else ids.push(contextAttachments.stage(file).id)
      }
      contextAttachments.resolve(ids)
      return { ids, images }
    } catch (error) { contextAttachments.release(ids); throw new RemoteError(400, (error as Error).message) }
  }
  const listModels = async (): Promise<RemoteModel[]> => {
    const choices = getAgentModelChoices(config.get())
    return choices.models.map(model => {
      const catalog = choices.catalog.find(provider => provider.id === model.provider)?.models.find(item => item.id === model.modelID)
      return {
        provider: model.provider,
        modelId: model.modelID,
        name: catalog?.name ?? model.modelName ?? model.modelID,
        supportsThinking: catalog?.reasoning ?? model.reasoning ?? false,
        thinkingLevels: catalog ? [...catalog.availableThinkingLevels] : ['off'],
        contextWindow: catalog?.contextWindow ?? model.contextWindow,
      }
    })
  }
  const checkModel = async (input: { provider: string; modelId: string }) => {
    const model = (await listModels()).find(model => model.provider === input.provider && model.modelId === input.modelId)
    if (!model) throw new RemoteError(400, 'Model is not configured')
    return model
  }
  const checkThinking = (model: RemoteModel, level: string) => {
    if (!model.thinkingLevels.includes(level)) throw new RemoteError(400, 'Thinking level is not supported')
  }
  const summary = async (id: string) => {
    const session = await requireSession(id)
    const snapshot = 'historical' in session && session.historical ? emptySnapshot() : await host.conversations.snapshot(id, BACKGROUND_CONTEXT)
    return agentSummary(session, isDurableRunning(snapshot))
  }
  const getConversation = async (id: string) => {
    const session = await requireSession(id)
    const workspace = await workspaces.resolve(session.workspaceId!)
    const permission = effectivePermissionMode(session.permissionMode, workspace.status === 'attached', config.get().defaultPermissionMode)
    const history = agentHistoryMessages(await host.readHistory(id, BACKGROUND_CONTEXT))
    if ('historical' in session && session.historical) return { ...agentRemoteSnapshot({ snapshot: emptySnapshot(), metadata: session, queue: [], approvals: [], permission }), messages: history }
    const snapshot = await host.conversations.snapshot(id, BACKGROUND_CONTEXT)
    const conversation = await host.engine.conversation(id, BACKGROUND_CONTEXT)
    const queue = (await host.engine.harness.snapshot(InboxDoc, conversation.id, BACKGROUND_CONTEXT))?.items ?? []
    const result = agentRemoteSnapshot({
      snapshot,
      metadata: session,
      queue,
      approvals: await host.pendingApprovals(id, BACKGROUND_CONTEXT),
      permission,
      contextWindow: host.models.contextWindow(snapshot.agent.model),
      compaction: getAgentCompactionSettings(config.get()),
      taskRuns: (await host.engine.harness.snapshot(runMembershipDoc, conversation.id, BACKGROUND_CONTEXT))?.tasks,
    })
    return { ...result, messages: [...history, ...result.messages] }
  }
  const sendPrepared = async (id: string, input: RemoteSendMessageInput, prepared: ReturnType<typeof prepareAttachments>) => {
    const content = prepared.images.length ? [{ type: 'text' as const, text: input.content }, ...prepared.images] : input.content
    await host.conversations.submit(id, {
      type: 'input',
      requestId: randomUUID(),
      content,
      whenBusy: input.mode === 'normal' ? 'reject' : input.mode,
      contextAttachmentIds: prepared.ids,
    }, BACKGROUND_CONTEXT)
  }
  const mutateQueue = async (id: string, input: RemoteQueueMutation) => {
    await requireLiveSession(id)
    if (!Number.isInteger(input.index) || input.index < 0 || (input.mode !== 'steer' && input.mode !== 'followUp') || (input.action === 'steer' && input.mode !== 'followUp') || (input.action === 'edit' && !input.value.trim()) || (input.action === 'move' && (!Number.isInteger(input.value) || input.value < 0))) throw new RemoteError(400, 'Invalid queue operation')
    const conversation = await host.engine.conversation(id, BACKGROUND_CONTEXT)
    const current = (await host.engine.harness.snapshot(InboxDoc, conversation.id, BACKGROUND_CONTEXT))?.items ?? []
    const items = current.filter((item) => item.mode === input.mode)
    const text = (item: InboxItem) => item.mode === 'write' ? '' : contentText(item.content)
    if (JSON.stringify(items.map(text)) !== JSON.stringify(input.expected) || input.index >= items.length) throw new RemoteError(409, 'Queue changed; refresh and retry')
    if (input.action === 'move' && input.value >= items.length) throw new RemoteError(400, 'Invalid queue operation')
    const target = items[input.index]!
    if (input.action === 'remove') await host.engine.harness.abortSubmission(target.id, BACKGROUND_CONTEXT, conversation.id)
    else await host.engine.harness.commit(async (tx) => {
      const doc = await tx.doc(InboxDoc, conversation.id)
      if (JSON.stringify(doc.items.filter((item) => item.mode === input.mode).map(text)) !== JSON.stringify(input.expected)) throw new RemoteError(409, 'Queue changed; refresh and retry')
      const index = doc.items.findIndex((item) => item.id === target.id)
      if (index < 0 || doc.items[index]?.mode !== input.mode) throw new RemoteError(409, 'Queue changed; refresh and retry')
      if (input.action === 'edit') {
        const item = doc.items[index]
        item.content = input.value as never
      } else if (input.action === 'steer') doc.items[index] = { ...doc.items[index], mode: 'steer' } as never
      else if (input.action === 'move') {
        const reordered = doc.items.filter((item) => item.mode === input.mode)
        const [item] = reordered.splice(input.index, 1)
        reordered.splice(input.value, 0, item!)
        let position = 0
        doc.items = doc.items.map((item) => item.mode === input.mode ? reordered[position++]! : item)
      }
    }, BACKGROUND_CONTEXT)
  }
  return {
    async assertConversation(id) { await requireSession(id) },
    async getState() {
      const model = getActiveModel(config.get())
      return {
        models: await listModels(),
        permissions: PERMISSION_MODES,
        defaults: { permission: config.get().defaultPermissionMode ?? 'workspace-write', provider: model.provider, modelId: model.modelID, thinkingLevel: model.thinkingLevel ?? 'off' },
      }
    },
    async listProjects() {
      const sessions = (await host.conversations.list(BACKGROUND_CONTEXT)).filter(session => !session.archived)
      return Promise.all((await workspaces.list()).filter(workspace => workspace.status === 'attached').map(async workspace => {
        const conversations = sessions.filter(session => session.workspaceId === workspace.id)
        const states = await Promise.all(conversations.map(session => summary(session.id)))
        return {
          id: workspace.id,
          name: workspace.displayName,
          conversationCount: conversations.length,
          activeRunCount: states.filter(state => state.status === 'running').length,
          updatedAt: Math.max(workspace.updatedAt, ...conversations.map(session => session.updatedAt)),
        }
      }))
    },
    async getProject(id) {
      const project = (await this.listProjects()).find(project => project.id === id)
      if (!project) throw new RemoteError(404, 'Project not found')
      return project
    },
    async listConversations(projectId) {
      await this.getProject(projectId)
      const sessions = (await host.conversations.list(BACKGROUND_CONTEXT)).filter(session => session.workspaceId === projectId && !session.archived)
      return Promise.all(sessions.map(session => summary(session.id)))
    },
    async createConversation(projectId, input) {
      await this.getProject(projectId)
      const workspace = await workspaces.resolve(projectId)
      if (workspace.status !== 'attached') throw new RemoteError(409, 'Project is unavailable')
      const files = validateRemoteAttachments(input.attachments)
      if (!PERMISSION_MODES.includes(input.permission) || (!input.prompt.trim() && !files.length)) throw new RemoteError(400, 'Permission and initial prompt are required')
      checkThinking(await checkModel(input), input.thinkingLevel)
      const prepared = prepareAttachments(files)
      try {
        const session = await host.create({ threadId: randomUUID(), workspaceId: projectId, permissionMode: input.permission }, BACKGROUND_CONTEXT)
        saveModelSelection({ provider: input.provider, modelId: input.modelId, thinkingLevel: input.thinkingLevel as ThinkingLevel })
        await host.configure(session.id, { model: { provider: input.provider, modelId: input.modelId }, thinkingLevel: input.thinkingLevel as ThinkingLevel }, BACKGROUND_CONTEXT)
        await sendPrepared(session.id, { content: input.prompt, mode: 'normal' }, prepared)
        return getConversation(session.id)
      } finally { contextAttachments.release(prepared.ids) }
    },
    getConversation,
    async continueConversation(id, threadId) {
      const source = await requireSession(id)
      if (!('historical' in source) || !source.historical) throw new RemoteError(409, 'Only historical conversations can be continued')
      const workspace = await workspaces.resolve(source.workspaceId!)
      if (workspace.status !== 'attached') throw new RemoteError(409, 'Project is unavailable')
      const target = await host.continueHistory(id, threadId, BACKGROUND_CONTEXT)
      return getConversation(target.id)
    },
    async renameConversation(id, title) {
      await requireSession(id)
      if (!title.trim()) throw new RemoteError(400, 'Title is required')
      await host.conversations.update(id, { title: title.trim() }, BACKGROUND_CONTEXT)
    },
    async sendMessage(id, input) {
      await requireLiveSession(id)
      const files = validateRemoteAttachments(input.attachments)
      if (!input.content.trim() && !files.length) throw new RemoteError(400, 'Message is required')
      if (!['normal', 'followUp', 'steer'].includes(input.mode)) throw new RemoteError(400, 'Invalid send mode')
      const prepared = prepareAttachments(files)
      try { await sendPrepared(id, input, prepared) } finally { contextAttachments.release(prepared.ids) }
    },
    async setPermission(id, mode) {
      await requireLiveSession(id)
      if (!PERMISSION_MODES.includes(mode)) throw new RemoteError(400, 'Invalid permission mode')
      await host.conversations.update(id, { permissionMode: mode }, BACKGROUND_CONTEXT)
    },
    async setModel(id, input) {
      await requireLiveSession(id)
      await checkModel(input)
      await host.configure(id, { model: input }, BACKGROUND_CONTEXT)
      saveModelSelection({ ...input, thinkingLevel: getActiveModel(config.get()).thinkingLevel ?? 'off' })
    },
    async setThinkingLevel(id, level) {
      await requireLiveSession(id)
      const snapshot = await getConversation(id)
      if (!snapshot.model) throw new RemoteError(409, 'Select a model first')
      checkThinking(await checkModel(snapshot.model), level)
      await host.configure(id, { thinkingLevel: level as ThinkingLevel }, BACKGROUND_CONTEXT)
      saveModelSelection({ ...snapshot.model, thinkingLevel: level as ThinkingLevel })
    },
    async cancel(id) { await requireLiveSession(id); await host.conversations.cancel(id, BACKGROUND_CONTEXT) },
    async clearQueue(id) {
      await requireLiveSession(id)
      const conversation = await host.engine.conversation(id, BACKGROUND_CONTEXT)
      const queue = (await host.engine.harness.snapshot(InboxDoc, conversation.id, BACKGROUND_CONTEXT))?.items ?? []
      await Promise.all(queue.filter((item) => item.mode !== 'write').map((item) => host.engine.harness.abortSubmission(item.id, BACKGROUND_CONTEXT, conversation.id)))
    },
    updateQueue: mutateQueue,
    async respondToApproval(id, input) {
      await requireLiveSession(input.conversationId)
      if ('value' in input) throw new RemoteError(400, 'A boolean approval decision is required')
      const state = 'confirmed' in input && input.confirmed === true ? 'approved' : 'rejected'
      await host.decideApproval(input.conversationId, id, state, BACKGROUND_CONTEXT)
    },
    listModels,
    subscribe(id, listener) {
      let seq = 0
      let active = true
      let current = emptySnapshot()
      const emit = (event: RemoteEventBody) => { if (active) listener({ ...event, seq: ++seq } as RemoteEvent) }
      let stop: (() => Promise<unknown>) | undefined
      void (async () => {
        const session = await requireSession(id)
        if ('historical' in session && session.historical) { emit({ type: 'snapshot', snapshot: await getConversation(id) }); return }
        const stream = await host.engine.watch(id, BACKGROUND_CONTEXT)
        stop = stream.stop
        if (!active) { await stop(); return }
        const approvals = await host.engine.harness.watchDoc(approvalSignalDoc, BACKGROUND_CONTEXT).catch(async (error) => { await stream.stop(); throw error })
        if (!approvals) { await stream.stop(); throw new Error('Approval document was not initialized') }
        stop = async () => { await Promise.all([stream.stop(), approvals.stop()]) }
        if (!active) { await stop(); return }
        current = stream.snapshot
        emit({ type: 'snapshot', snapshot: await getConversation(id) })
        let tail = Promise.resolve()
        const refresh = (events: Parameters<typeof applyDurableEvent>[1][]) => tail = tail.then(async () => {
          if (!active) return
          for (const event of events) current = applyDurableEvent(current, event)
          const conversation = await host.engine.conversation(id, BACKGROUND_CONTEXT)
          const queue = (await host.engine.harness.snapshot(InboxDoc, conversation.id, BACKGROUND_CONTEXT))?.items ?? []
          emit({ type: 'queue', queue: agentQueue(queue) })
          emit({ type: 'approvals', approvals: (await host.pendingApprovals(id, BACKGROUND_CONTEXT)).map(agentApproval) })
          emit({ type: 'status', status: isDurableRunning(current) ? 'running' : 'idle' })
          emit({ type: 'snapshot', snapshot: await getConversation(id) })
        }).catch(async () => { await stop?.(); emit({ type: 'error', error: 'Unable to refresh conversation' }) })
        stream.start((events) => refresh([...events]))
        approvals.start(() => refresh([]))
      })().catch(async () => { await stop?.(); emit({ type: 'error', error: 'Unable to refresh conversation' }) })
      return () => { active = false; void stop?.() }
    },
  }
}
