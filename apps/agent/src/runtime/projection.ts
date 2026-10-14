import { projectDurableThread, snapshotContextUsage } from '@kklyeenook/shared/agent/projection'
export { applyAgentEvent as applyDurableEvent } from '@kklyeenook/shared/agent/projection'
import { calculateAgentContextBudget } from '@kklyeenook/shared/agent/agentContextBudget'
import { DEFAULT_AGENT_COMPACTION_SETTINGS, type AgentCompactionSettings } from '@kklyeenook/shared/agent/agentConfig'
import { collectAgentFileChanges } from '@kklyeenook/shared/agent/agentFileChanges'
import type { Message, UserMessage } from '@earendil-works/pi-ai'
import type { InboxItem, SnapshotEvent } from '@earendil-works/pi-durable'
import type {
  RemoteActivity,
  RemoteApproval,
  RemoteConversationSnapshot,
  RemoteConversationSummary,
  RemoteMessage,
  RemoteQueueItem,
} from '@kklyeenook/shared/remote/index'
import type { AgentSessionRecord } from '../db/repositories/agent-session-repo'
import type { AgentApproval } from '@kklyeenook/shared/agent/chat-protocol'
import type { PermissionMode } from '@kklyeenook/shared/approval/permission'
import { deriveAgentActivities } from '@kklyeenook/shared/agent/deriveAgentActivities'
import { groupAgentActivities } from '@kklyeenook/shared/agent/groupAgentActivities'
import { formatActivityLabel } from '@kklyeenook/shared/agent/agentActivityFormatter'
import { summarizeAgentActivities } from '@kklyeenook/shared/agent/agentActivitySummary'
import type { AgentEventEnvelope } from '@kklyeenook/shared/agent/agentExecutionRecord'
import type { AgentEvent as ActivityEvent } from '@kklyeenook/shared/agent/agentEvent'

export function agentSummary(
  record: AgentSessionRecord,
  running: boolean,
): RemoteConversationSummary {
  return {
    id: record.id,
    projectId: record.workspaceId ?? '',
    botId: record.botId,
    archived: record.archived,
    title: record.title ?? 'New Conversation',
    status: running ? 'running' : 'idle',
    updatedAt: record.updatedAt,
  }
}

export function agentRemoteSnapshot(input: {
  snapshot: SnapshotEvent
  metadata: AgentSessionRecord
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
    contextBudget: calculateAgentContextBudget({ ...contextUsage, tokens: contextUsage.tokens ?? undefined, contextWindow: contextUsage.contextWindow || undefined, percent: contextUsage.percent ?? undefined }, input.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS, { compacting: input.snapshot.compactions.length > 0 }),
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
  const projected = projectDurableThread({ snapshot, approvals: [], queue: [], sequence: 0 })
  const rawMessages = snapshot.entries.flatMap((entry) => entry.model ?? [])
  if (snapshot.generation?.message) rawMessages.push(snapshot.generation.message)
  return projected.messages.filter((message) => message.role !== 'system').map((message) => {
    const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content
    const custom = message.metadata?.custom
    const durable = custom?.durable as RemoteMessage['model'] & { usage?: RemoteMessage['usage'] } | undefined
    const execution = custom?.execution as RemoteMessage['execution']
    const usage = rawMessages.filter((raw) => raw.role === 'assistant' && execution && raw.timestamp >= execution.startedAt && raw.timestamp <= message.createdAt!.getTime()).reduce((total, raw) => {
      if (raw.role === 'assistant') {
        total.input += raw.usage.input
        total.output += raw.usage.output
        total.cacheRead += raw.usage.cacheRead
        total.cacheWrite += raw.usage.cacheWrite
      }
      return total
    }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    const fileChanges = collectAgentFileChanges(parts.filter((part) => part.type === 'tool-call').map((part) => ({
      toolName: part.toolName, args: part.args, result: part.result, isError: part.isError, approvalRejected: part.approval?.approved === false,
    }))).map(({ diff: _diff, ...file }) => file)
    return {
      id: message.id!, role: message.role as 'user' | 'assistant', timestamp: message.createdAt!.getTime(),
      content: parts.flatMap((part): RemoteMessage['content'] => {
        if (part.type === 'text' || part.type === 'reasoning') return [{ type: part.type, text: part.text }]
        if (part.type === 'image' && part.image) return [{ type: 'image', image: part.image }]
        if (part.type === 'data' && part.name === 'pi-compaction-summary') return [{ type: 'text', text: (part.data as { summary: string }).summary }]
        if (part.type === 'tool-call') return [{ type: 'data', name: 'tool-call', data: { toolCallId: part.toolCallId! } }]
        return []
      }),
      ...(message.role === 'assistant' ? {
        status: message.status?.type === 'running' || message.status?.type === 'requires-action' ? 'running' as const : message.status?.type === 'incomplete' ? message.status.reason === 'cancelled' ? 'cancelled' as const : 'failed' as const : 'complete' as const,
        execution, stepCount: message.metadata?.steps?.length,
        model: durable ? { provider: durable.provider, model: durable.model, thinkingLevel: durable.thinkingLevel } : undefined,
        usage: execution ? usage : durable?.usage, ...(fileChanges.length ? { fileChanges } : {}),
      } : {}),
    }
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

export function contentText(content: UserMessage['content']) {
  if (typeof content === 'string') return content
  return content.map((part) => part.type === 'text' ? part.text : '[image]').join('\n')
}
