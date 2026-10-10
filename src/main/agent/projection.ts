import { snapshotContextUsage } from '@kklyeenook/shared/agent/projection'
import { calculateAgentContextBudget } from '@/shared/agent/agentContextBudget'
import { DEFAULT_AGENT_COMPACTION_SETTINGS, type AgentCompactionSettings } from '@/shared/agent/agentConfig'
import type { AssistantMessage, Message, UserMessage } from '@earendil-works/pi-ai'
import type { AgentEvent, EntryRecord, InboxItem, SnapshotEvent } from '@earendil-works/pi-durable'
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
    activities: agentActivities(input.snapshot),
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
  return Boolean(snapshot.run || snapshot.generation || snapshot.tools.length || snapshot.compactions.length)
}

export function agentMessages(snapshot: SnapshotEvent): RemoteMessage[] {
  const messages = snapshot.entries.flatMap((entry) => entryMessages(entry, false))
  if (snapshot.generation?.message) messages.push(messageToRemote(snapshot.generation.message, `partial:${snapshot.generation.attempt}`, true))
  return messages.filter((message): message is RemoteMessage => Boolean(message))
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

export function agentActivities(snapshot: SnapshotEvent): RemoteActivity[] {
  return snapshot.tools.map((tool, index) => ({
    id: `tool:${tool.callId}`,
    label: tool.name,
    status: tool.status === 'done' ? 'completed' : 'running',
    type: 'tool',
    runId: snapshot.run?.inputs.join(',') ?? 'durable',
    runCreatedAt: 0,
    textOffset: index,
    toolCallId: tool.callId,
    summary: tool.name,
  }))
}

export function applyDurableEvent(snapshot: SnapshotEvent, event: AgentEvent): SnapshotEvent {
  if (event.type === 'snapshot') return event
  if (event.type === 'entry_appended' || event.type === 'message_end') {
    const entry = event.type === 'entry_appended' ? event.entry : event.entry
    return { ...snapshot, entries: [...snapshot.entries, entry] }
  }
  if (event.type === 'agent_changed') return { ...snapshot, agent: event.agent }
  if (event.type === 'usage_changed') return { ...snapshot, usage: event.usage }
  if (event.type === 'run_start') return { ...snapshot, run: { inputs: event.inputs } }
  if (event.type === 'run_end') return { ...snapshot, run: undefined, generation: undefined, tools: [] }
  if (event.type === 'inbox_update') return { ...snapshot, inbox: event.items }
  return snapshot
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
      if (part.type === 'thinking') content.push({ type: 'reasoning', text: part.thinking })
      if (part.type === 'image') content.push({ type: 'image', image: `data:${part.mimeType};base64,${part.data}` })
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
