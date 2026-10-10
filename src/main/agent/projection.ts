import { snapshotContextUsage } from '@kklyeenook/shared/agent/projection'
export { applyAgentEvent as applyDurableEvent } from '@kklyeenook/shared/agent/projection'
import { calculateAgentContextBudget } from '@/shared/agent/agentContextBudget'
import { DEFAULT_AGENT_COMPACTION_SETTINGS, type AgentCompactionSettings } from '@/shared/agent/agentConfig'
import type { AssistantMessage, Message, UserMessage } from '@earendil-works/pi-ai'
import type { EntryRecord, InboxItem, SnapshotEvent } from '@earendil-works/pi-durable'
import type {
  RemoteActivity,
  RemoteApproval,
  RemoteConversationSnapshot,
  RemoteConversationSummary,
  RemoteMessage,
  RemoteQueueItem,
} from '@kklyeenook/shared/remote/index'
import type { AgentSessionRecord } from '../db/repositories/agentSessionRepo'
import type { AgentApproval } from '@/shared/agent/chat-protocol'
import type { PermissionMode } from '@/shared/approval/permission'
import { deriveAgentActivities } from '@/shared/agent/deriveAgentActivities'
import { groupAgentActivities } from '@/shared/agent/groupAgentActivities'
import { formatActivityLabel } from '@/shared/agent/agentActivityFormatter'
import { summarizeAgentActivities } from '@/shared/agent/agentActivitySummary'
import type { AgentEventEnvelope } from '@/shared/agent/agentExecutionRecord'
import type { AgentEvent as ActivityEvent } from '@/shared/agent/agentEvent'
import type { HistoryRecord } from '@kklyeenook/shared/agent/chat-protocol'

export function agentSummary(
  record: AgentSessionRecord & { historical?: boolean },
  running: boolean,
): RemoteConversationSummary {
  return {
    id: record.id,
    projectId: record.workspaceId ?? '',
    title: record.title ?? 'New Conversation',
    status: running ? 'running' : 'idle',
    updatedAt: record.updatedAt,
    ...(record.historical ? { historical: true } : {}),
  }
}

export function agentRemoteSnapshot(input: {
  snapshot: SnapshotEvent
  metadata: AgentSessionRecord & { historical?: boolean }
  queue: readonly InboxItem[]
  approvals: readonly AgentApproval[]
  permission: PermissionMode
  contextWindow?: number
  compaction?: AgentCompactionSettings
  taskRuns?: Readonly<Record<string, number>>
}): RemoteConversationSnapshot {
  const running = isDurableRunning(input.snapshot)
  const summary = agentSummary(input.metadata, running)
  const agent = input.snapshot.agent
  const contextUsage = snapshotContextUsage(input.snapshot, input.contextWindow)
  return {
    ...summary,
    permission: input.permission,
    model: agent.model ? { provider: agent.model.provider, modelId: agent.model.modelId } : undefined,
    thinkingLevel: agent.thinkingLevel ?? 'off',
    contextUsage,
    contextBudget: calculateAgentContextBudget({ tokens: contextUsage.tokens ?? undefined, contextWindow: contextUsage.contextWindow || undefined }, input.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS, { compacting: input.snapshot.compactions.length > 0 }),
    messages: agentMessages(input.snapshot),
    activities: agentActivities(input.snapshot, input.taskRuns),
    queue: agentQueue(input.queue),
    approvals: input.approvals.map(agentApproval),
  }
}

export function emptySnapshot(): SnapshotEvent {
  return {
    type: 'snapshot',
    entries: [],
    tools: [],
    compactions: [],
    inbox: [],
    agent: {},
    usage: { models: {}, tools: {} },
  }
}

export function isDurableRunning(snapshot: SnapshotEvent) {
  return Boolean(snapshot.run || snapshot.generation || snapshot.tools.some((tool) => tool.status !== 'done') || snapshot.compactions.length)
}

export function agentMessages(snapshot: SnapshotEvent): RemoteMessage[] {
  const messages = snapshot.entries.flatMap((entry) => entryMessages(entry, false))
  if (snapshot.generation?.message) messages.push(messageToRemote(snapshot.generation.message, `partial:${snapshot.generation.attempt}`, true))
  return messages.filter((message): message is RemoteMessage => Boolean(message))
}

export function agentHistoryMessages(records: readonly HistoryRecord[]): RemoteMessage[] {
  return records.flatMap((record) => {
    if (record.kind === 'header') return []
    const payload = record.payload as Record<string, unknown> | null
    if (!payload || typeof payload !== 'object') return []
    const message = (payload.message ?? payload) as Record<string, unknown>
    const content: RemoteMessage['content'] = []
    if (record.role === 'tool') content.push({ type: 'text', text: '历史工具输出（只读）\n' })
    if (typeof message.content === 'string') content.push({ type: 'text', text: message.content })
    else if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === 'text' && typeof part.text === 'string') content.push({ type: 'text', text: part.text })
      else if (part.type === 'thinking' && typeof part.thinking === 'string') content.push({ type: 'reasoning', text: part.redacted ? '[reasoning redacted]' : part.thinking })
      else if (part.type === 'image' && typeof part.data === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType)) content.push({ type: 'image', image: `data:${part.mimeType};base64,${part.data}` })
      else if (part.type === 'toolCall') content.push({ type: 'text', text: `历史工具调用（未重放）：${String(part.name)}` })
    }
    if (!content.length && typeof payload.summary === 'string') content.push({ type: 'text', text: payload.summary })
    if (!content.length && record.kind === 'diagnostic') content.push({ type: 'text', text: '历史记录读取诊断：记录无法解析' })
    if (!content.length) return []
    return [{ id: `history:${record.id}`, role: record.role === 'user' ? 'user' as const : 'assistant' as const, timestamp: record.createdAt, content, status: 'complete' as const }]
  })
}

export function agentQueue(items: readonly InboxItem[]): RemoteQueueItem[] {
  const byMode = {
    steer: items.filter((item): item is Exclude<InboxItem, { mode: 'write' }> => item.mode === 'steer'),
    followUp: items.filter((item): item is Exclude<InboxItem, { mode: 'write' }> => item.mode === 'followUp'),
  }
  return [
    ...byMode.steer.map((item, index) => ({
      id: String(item.id),
      text: contentText(item.content),
      steer: true,
      index,
      expected: byMode.steer.map((value) => contentText(value.content)),
    })),
    ...byMode.followUp.map((item, index) => ({
      id: String(item.id),
      text: contentText(item.content),
      steer: false,
      index,
      expected: byMode.followUp.map((value) => contentText(value.content)),
    })),
  ]
}

export function agentApproval(input: AgentApproval): RemoteApproval {
  const title = typeof input.request.permission === 'object' && input.request.permission && 'toolName' in input.request.permission
    ? String(input.request.permission.toolName)
    : input.toolName
  return {
    id: input.id,
    title,
    kind: 'confirm',
    message: input.reason,
  }
}

export function agentActivities(snapshot: SnapshotEvent, taskRuns: Readonly<Record<string, number>> = {}): RemoteActivity[] {
  const groups = new Map<string, AgentEventEnvelope[]>()
  const calls = new Map<string, string>()
  let runId = 'history'
  const push = (id: string, event: ActivityEvent, timestamp: number) => {
    const records = groups.get(id) ?? []
    records.push({ runId: id, sessionId: '', seq: records.length + 1, timestamp, event })
    groups.set(id, records)
  }
  const visit = (message: Message, id: string) => {
    if (message.role === 'assistant') for (const part of message.content) {
      if (part.type === 'text') push(id, { type: 'text_delta', text: part.text }, message.timestamp)
      else if (part.type === 'thinking') push(id, { type: 'thinking_delta', text: part.redacted ? '[reasoning redacted]' : part.thinking }, message.timestamp)
      else if (part.type === 'toolCall') {
        calls.set(part.id, id)
        push(id, { type: 'tool_started', call: { id: part.id, toolName: part.name, args: {} } }, message.timestamp)
      }
    }
    else if (message.role === 'toolResult') push(calls.get(message.toolCallId) ?? id, { type: 'tool_finished', result: {
      toolCallId: message.toolCallId, toolName: message.toolName, status: message.isError ? 'error' : 'success', content: [],
    } }, message.timestamp)
  }
  for (const entry of snapshot.entries) for (const message of entry.model ?? []) {
    if (message.role === 'user') runId = `history:${entry.id}`
    const input = entry.byTaskId === undefined ? undefined : taskRuns[String(entry.byTaskId)]
    if (input !== undefined) runId = `input:${input}`
    visit(message, runId)
  }
  const active = snapshot.run?.inputs[0]
  const activeId = active === undefined ? runId : `input:${active}`
  if (snapshot.generation?.message) visit(snapshot.generation.message, activeId)
  for (const tool of snapshot.tools) if (!calls.has(tool.callId)) {
    push(activeId, { type: 'tool_started', call: { id: tool.callId, toolName: tool.name, args: {} } }, 0)
    if (tool.status === 'done') push(activeId, { type: 'tool_finished', result: { toolCallId: tool.callId, toolName: tool.name, status: 'success', content: [] } }, 0)
  }
  return [...groups].flatMap(([id, records]) => {
    const running = id === activeId && isDurableRunning(snapshot)
    const createdAt = records[0]?.timestamp ?? 0
    const endedAt = records.at(-1)?.timestamp ?? createdAt
    const activities = deriveAgentActivities(records, { status: running ? 'running' : 'completed', updatedAt: endedAt, completedAt: running ? undefined : endedAt })
    return groupAgentActivities(records, activities).flatMap((segment) => segment.activities.map((activity) => ({
      id: activity.id, label: formatActivityLabel(activity), status: activity.status, type: activity.type,
      detail: activity.type === 'thinking' ? activity.content : undefined,
      runId: id, runCreatedAt: createdAt, runCompletedAt: running ? undefined : endedAt,
      startedAt: activity.startedAt, endedAt: activity.endedAt, textOffset: segment.textOffset,
      toolCallId: 'call' in activity ? activity.call.id : undefined, summary: summarizeAgentActivities(segment.activities),
    })))
  })
}

function entryMessages(entry: EntryRecord, streaming: boolean) {
  return (entry.model ?? []).map((message, index) => messageToRemote(message, `${entry.id}:${index}`, streaming))
}

function messageToRemote(message: Message, id: string, streaming: boolean): RemoteMessage | undefined {
  if (message.role !== 'user' && message.role !== 'assistant') return undefined
  const content: RemoteMessage['content'] = []
  const raw = message.content
  if (typeof raw === 'string') content.push({ type: 'text', text: raw })
  else {
    for (const part of raw) {
      if (part.type === 'text') content.push({ type: 'text', text: part.text })
      if (part.type === 'thinking') content.push({ type: 'reasoning', text: part.redacted ? '[reasoning redacted]' : part.thinking })
      if (part.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType)) content.push({ type: 'image', image: `data:${part.mimeType};base64,${part.data}` })
      if (part.type === 'toolCall') content.push({ type: 'data', name: 'tool-call', data: { toolCallId: part.id } })
    }
  }
  return {
    id,
    role: message.role,
    timestamp: message.timestamp,
    content,
    ...(message.role === 'assistant' ? assistantFields(message, streaming) : {}),
  }
}

function assistantFields(message: AssistantMessage, streaming: boolean) {
  return {
    status: streaming ? 'running' as const : message.stopReason === 'error' ? 'failed' as const : message.stopReason === 'aborted' ? 'cancelled' as const : 'complete' as const,
    usage: {
      input: message.usage.input,
      output: message.usage.output,
      cacheRead: message.usage.cacheRead,
      cacheWrite: message.usage.cacheWrite,
    },
  }
}

export function contentText(content: UserMessage['content']) {
  if (typeof content === 'string') return content
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
}
