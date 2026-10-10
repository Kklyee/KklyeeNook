import type { PiClientEvent, PiThinkingLevel } from '@assistant-ui/react-pi'
import type { PiSendMessageInput } from '@assistant-ui/react-pi'
import { PERMISSION_MODES, effectivePermissionMode } from '@kklyeenook/shared/approval/permission'
import type {
  RemoteActivity,
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
import type { WorkspaceService } from '../workspace/workspaceService'
import type { AgentService } from '../agent/agentService'
import type { PiClientService } from '../agent/pi/client/piClientService'
import type { PiSessionRuntimeManager } from '../agent/pi/runtime/piSessionRuntimeManager'
import type { ExecutionContextService } from '../workspace/executionContextService'
import type { AgentConfigStore } from '../settings/agentConfigStore'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'
import { deriveAgentActivities } from '@/shared/agent/deriveAgentActivities'
import { groupAgentActivities } from '@/shared/agent/groupAgentActivities'
import { formatActivityLabel } from '@/shared/agent/agentActivityFormatter'
import { summarizeAgentActivities } from '@/shared/agent/agentActivitySummary'
import { getActiveModel, getAgentCompactionSettings } from '@/shared/agent/agentConfig'
import { calculateAgentContextBudget } from '@/shared/agent/agentContextBudget'
import { toAgentContextUsage } from '@/shared/agent/agentContextUsage'
import { getAgentModelChoices } from '../settings/model-catalog'
import type { UpdateAgentModelSelectionRequest } from '@/shared/agent/agentSettings'
import type { ThinkingLevel } from '@/shared/agent/agentConfig'
import { remoteApproval, remoteMessage, remoteQueue, remoteSnapshot } from './remoteState'
import { validateRemoteAttachments } from './remoteAttachments'
import type { ContextAttachmentService } from '../context/contextAttachmentService'
import type { RemoteFileAttachment } from '@kklyeenook/shared/remote/index'

export class RemoteError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 413, message: string) { super(message) }
}

export interface RemoteAgentPort {
  assertConversation(id: string): void
  getState(): Promise<RemoteState>
  listProjects(): Promise<RemoteProject[]>
  getProject(id: string): Promise<RemoteProject>
  listConversations(projectId: string): Promise<RemoteConversationSummary[]>
  createConversation(projectId: string, input: RemoteCreateConversationInput): Promise<RemoteConversationSnapshot>
  getConversation(id: string): Promise<RemoteConversationSnapshot>
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
  agents: AgentService,
  pi: PiClientService,
  runtimes: PiSessionRuntimeManager,
  executionContexts: ExecutionContextService,
  config: AgentConfigStore,
  saveModelSelection: (selection: UpdateAgentModelSelectionRequest) => void,
  contextAttachments: ContextAttachmentService,
): RemoteAgentPort {
  const requireSession = (id: string) => {
    const session = agents.getSession(id)?.toSummary()
    if (!session || !session.workspaceId) throw new RemoteError(404, 'Conversation not found')
    return session
  }
  const prepareAttachments = (files: RemoteFileAttachment[]) => {
    const ids: string[] = []
    const images: NonNullable<PiSendMessageInput['attachments']> = []
    try {
      for (const file of files) {
        if (file.type === 'image') images.push({ type: 'image', mimeType: file.mimeType, data: file.data })
        else ids.push(contextAttachments.stage(file).id)
      }
      contextAttachments.resolve(ids)
      return { ids, images }
    } catch (error) { contextAttachments.release(ids); throw new RemoteError(400, (error as Error).message) }
  }
  const sendPrepared = async (id: string, input: PiSendMessageInput, prepared: ReturnType<typeof prepareAttachments>) => {
    const request = { ...input, ...(prepared.images.length ? { attachments: prepared.images } : {}) }
    if (prepared.ids.length) await pi.sendMessage(id, request, prepared.ids)
    else await pi.sendMessage(id, request)
  }
  const summary = (session: AgentSessionSummary): RemoteConversationSummary => ({
    id: session.id,
    projectId: session.workspaceId!,
    title: session.title ?? 'New Conversation',
    status: session.activeRunId ? 'running' : 'idle',
    updatedAt: session.updatedAt,
  })
  const contextBudget = (usage: RemoteConversationSnapshot['contextUsage']) => calculateAgentContextBudget(toAgentContextUsage(usage), getAgentCompactionSettings(config.get()))
  const activitySnapshots = new Map<string, RemoteActivity[]>()
  const activities = async (id: string): Promise<RemoteActivity[]> => {
    const runs = (await agents.listRuns(id)).filter(run => !run.parentRunId).sort((a, b) => a.createdAt - b.createdAt)
    const result = (await Promise.all(runs.map(async run => {
      const records = await agents.listExecutionRecords(run.id)
      const derived = deriveAgentActivities(records, run)
      return groupAgentActivities(records, derived).flatMap(segment => segment.activities.map(activity => ({
        id: activity.id,
        type: activity.type,
        label: formatActivityLabel(activity),
        status: activity.status,
        detail: activity.type === 'thinking' ? activity.content : 'call' in activity ? [JSON.stringify(activity.call.args), activity.result?.content.filter(part => part.type === 'text').map(part => part.text).join('\n')].filter(Boolean).join('\n') : undefined,
        startedAt: activity.startedAt,
        endedAt: activity.endedAt,
        runId: run.id,
        runCreatedAt: run.createdAt,
        runCompletedAt: run.completedAt,
        textOffset: segment.textOffset,
        toolCallId: 'call' in activity ? activity.call.id : undefined,
        summary: summarizeAgentActivities(segment.activities),
      })))
    }))).flat()
    activitySnapshots.set(id, result)
    return result
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
  const assertIdle = (id: string) => {
    const session = requireSession(id)
    if (session.activeRunId || runtimes.get(id)?.isRunning()) throw new RemoteError(409, 'Wait for the current run to finish')
  }
  const getConversation = async (id: string, includeActivities = true) => {
    const session = requireSession(id)
    const context = await executionContexts.resolve(id)
    const snapshot = remoteSnapshot(await pi.getThread(id), summary(session), effectivePermissionMode(session.permissionMode, !!context.workspace, config.get().defaultPermissionMode))
    snapshot.contextBudget = contextBudget(snapshot.contextUsage)
    snapshot.activities = includeActivities ? await activities(id) : activitySnapshots.get(id) ?? []
    return snapshot
  }
  const listProjects = async () => {
    const sessions = (await agents.listSessions()).filter(session => !session.archived)
    return (await workspaces.list()).filter(workspace => workspace.status === 'attached').map(workspace => {
      const conversations = sessions.filter(session => session.workspaceId === workspace.id)
      return {
        id: workspace.id,
        name: workspace.displayName,
        conversationCount: conversations.length,
        activeRunCount: conversations.filter(session => session.activeRunId).length,
        updatedAt: Math.max(workspace.updatedAt, ...conversations.map(session => session.updatedAt)),
      }
    })
  }
  const getProject = async (id: string) => {
    const project = (await listProjects()).find(project => project.id === id)
    if (!project) throw new RemoteError(404, 'Project not found')
    return project
  }
  const setPermission = async (id: string, mode: RemotePermissionMode) => {
    assertIdle(id)
    if (!PERMISSION_MODES.includes(mode)) throw new RemoteError(400, 'Invalid permission mode')
    const context = await executionContexts.resolve(id)
    if (mode === 'workspace-write' && !context.workspace) throw new RemoteError(409, 'Project is unavailable')
    await agents.setPermissionMode(id, mode)
    runtimes.get(id)?.reloadConfiguration()
  }
  return {
    assertConversation(id) { requireSession(id) },
    async getState() {
      const model = getActiveModel(config.get())
      return {
        models: await listModels(),
        permissions: PERMISSION_MODES,
        defaults: { permission: config.get().defaultPermissionMode ?? 'workspace-write', provider: model.provider, modelId: model.modelID, thinkingLevel: model.thinkingLevel ?? 'off' },
      }
    },
    listProjects,
    getProject,
    async listConversations(projectId) {
      await getProject(projectId)
      return (await agents.listSessions()).filter(session => session.workspaceId === projectId && !session.archived).map(summary).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async createConversation(projectId, input) {
      await getProject(projectId)
      const workspace = await workspaces.resolve(projectId)
      if (workspace.status !== 'attached') throw new RemoteError(409, 'Project is unavailable')
      const files = validateRemoteAttachments(input.attachments)
      if (!PERMISSION_MODES.includes(input.permission) || (!input.prompt.trim() && !files.length)) throw new RemoteError(400, 'Permission and initial prompt are required')
      checkThinking(await checkModel(input), input.thinkingLevel)
      const prepared = prepareAttachments(files)
      try {
      const session = await agents.createSession(undefined, projectId)
      await setPermission(session.id, input.permission)
      saveModelSelection({ provider: input.provider, modelId: input.modelId, thinkingLevel: input.thinkingLevel as ThinkingLevel })
      await pi.setModel(session.id, input)
      await pi.setThinkingLevel(session.id, input.thinkingLevel as PiThinkingLevel)
      await sendPrepared(session.id, { content: input.prompt }, prepared)
      return getConversation(session.id)
      } finally { contextAttachments.release(prepared.ids) }
    },
    getConversation,
    async renameConversation(id, title) {
      requireSession(id)
      if (!title.trim()) throw new RemoteError(400, 'Title is required')
      await pi.renameThread(id, title.trim())
    },
    async sendMessage(id, input) {
      const session = requireSession(id)
      const files = validateRemoteAttachments(input.attachments)
      if (!input.content.trim() && !files.length) throw new RemoteError(400, 'Message is required')
      if (!['normal', 'followUp', 'steer'].includes(input.mode)) throw new RemoteError(400, 'Invalid send mode')
      if (input.mode === 'normal' && (session.activeRunId || runtimes.get(id)?.isRunning())) throw new RemoteError(409, 'Run is active; choose follow-up or steer')
      if (files.some(file => file.type === 'text')) assertIdle(id)
      const prepared = prepareAttachments(files)
      try { await sendPrepared(id, { content: input.content, streamingBehavior: input.mode === 'normal' ? undefined : input.mode }, prepared) }
      finally { contextAttachments.release(prepared.ids) }
    },
    setPermission,
    async setModel(id, input) {
      assertIdle(id)
      const model = await checkModel(input)
      const configured = getAgentModelChoices(config.get()).models.find(item => item.provider === input.provider && item.modelID === input.modelId)
      const thinkingLevel = configured?.thinkingLevel ?? model.thinkingLevels[0] ?? 'off'
      await pi.setModel(id, input)
      saveModelSelection({ ...input, thinkingLevel: thinkingLevel as ThinkingLevel })
      await pi.setThinkingLevel(id, thinkingLevel as PiThinkingLevel)
    },
    async setThinkingLevel(id, level) {
      assertIdle(id)
      const snapshot = await getConversation(id)
      if (!snapshot.model) throw new RemoteError(409, 'Select a model first')
      checkThinking(await checkModel(snapshot.model), level)
      await pi.setThinkingLevel(id, level as PiThinkingLevel)
      saveModelSelection({ ...snapshot.model, thinkingLevel: level as ThinkingLevel })
    },
    async cancel(id) { requireSession(id); await pi.cancelRun(id) },
    async clearQueue(id) { requireSession(id); await pi.clearQueue(id) },
    async updateQueue(id, input) {
      requireSession(id)
      try { await pi.updateQueuedMessage(id, input) }
      catch { throw new RemoteError(409, 'Queue changed; refresh and retry') }
    },
    async respondToApproval(id, input) {
      requireSession(input.conversationId)
      const snapshot = await pi.getThread(input.conversationId)
      const request = snapshot.hostUiRequests?.find(request => request.id === id)
      if (!request) throw new RemoteError(409, 'Approval is no longer pending')
      if (request.kind === 'confirm' && !('confirmed' in input)) throw new RemoteError(400, 'Confirmation is required')
      if (request.kind !== 'confirm' && 'confirmed' in input) throw new RemoteError(400, 'Invalid approval response')
      if (request.kind === 'select' && 'value' in input && !request.options.includes(input.value)) throw new RemoteError(400, 'Invalid approval option')
      const response = 'confirmed' in input ? { requestId: id, confirmed: input.confirmed } : 'value' in input ? { requestId: id, value: input.value } : { requestId: id, dismissed: true as const }
      await pi.respondToHostUiRequest(input.conversationId, response)
    },
    listModels,
    subscribe(id, listener) {
      requireSession(id)
      let seq = 0
      let active = true
      let approvals: RemoteConversationSnapshot['approvals'] = []
      let chain = Promise.resolve()
      let ready = false
      let refreshing = false
      let activityPending = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const emit = (event: RemoteEventBody) => { if (active) listener({ ...event, seq: ++seq } as RemoteEvent) }
      const refreshActivities = () => {
        activityPending = true
        if (!active || !ready || refreshing || timer) return
        timer = setTimeout(async () => {
          timer = undefined
          refreshing = true
          activityPending = false
          try { emit({ type: 'activity', activities: await activities(id) }) }
          catch { emit({ type: 'error', error: 'Unable to refresh conversation activity' }) }
          finally {
            refreshing = false
            if (active && activityPending) refreshActivities()
          }
        }, 150)
      }
      const publishSnapshot = (snapshot: RemoteConversationSnapshot) => {
        approvals = snapshot.approvals
        emit({ type: 'snapshot', snapshot })
        ready = true
        refreshActivities()
      }
      const receive = async (event: PiClientEvent) => {
        if (!active) return
        switch (event.type) {
          case 'snapshot': {
            const context = await executionContexts.resolve(id)
            const session = requireSession(id)
            const snapshot = remoteSnapshot(event.snapshot, summary(session), effectivePermissionMode(session.permissionMode, !!context.workspace, config.get().defaultPermissionMode))
            snapshot.contextBudget = contextBudget(snapshot.contextUsage)
            snapshot.activities = activitySnapshots.get(id) ?? []
            publishSnapshot(snapshot)
            break
          }
          case 'message_start':
          case 'message_update':
          case 'message_end': {
            const message = remoteMessage(event.message, event.type !== 'message_end')
            if (message) emit({ type: 'message', message } as RemoteEventBody)
            break
          }
          case 'context_usage': emit({ type: 'context', contextUsage: event.contextUsage, contextBudget: contextBudget(event.contextUsage) }); break
          case 'queue_update': emit({ type: 'queue', queue: remoteQueue(event.steering, event.followUp) } as RemoteEventBody); break
          case 'extension_ui_request':
            approvals = [...approvals.filter(item => item.id !== event.request.id), remoteApproval(event.request)]
            emit({ type: 'approvals', approvals } as RemoteEventBody)
            break
          case 'extension_ui_resolved':
            approvals = approvals.filter(item => item.id !== event.requestId)
            emit({ type: 'approvals', approvals } as RemoteEventBody)
            break
          case 'agent_start': emit({ type: 'status', status: 'running' } as RemoteEventBody); break
          case 'agent_settled':
            publishSnapshot(await getConversation(id, false))
            break
          case 'session_info_changed':
          case 'thinking_level_changed':
            if (!runtimes.get(id)?.isRunning()) publishSnapshot(await getConversation(id, false))
            break
          case 'error': emit({ type: 'error', error: event.error } as RemoteEventBody); break
        }
      }
      const unsubscribePi = pi.subscribe(id, event => {
        chain = chain.then(() => receive(event)).catch(() => emit({ type: 'error', error: 'Unable to refresh conversation' } as RemoteEventBody))
      })
      const unsubscribeActivity = agents.subscribe(envelope => {
        if (envelope.sessionId === id) refreshActivities()
      })
      return () => { active = false; clearTimeout(timer); unsubscribePi(); unsubscribeActivity() }
    },
  }
}
