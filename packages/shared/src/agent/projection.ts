import type { ThreadMessageLike } from '@assistant-ui/react'
import type { AgentEvent, EntryRecord, InboxItem, SnapshotEvent } from '@earendil-works/pi-durable'
import type { AssistantMessage, Message, ToolCall, ToolResultMessage, Usage } from '@earendil-works/pi-ai'
import type { AgentApproval, AgentFrame } from './chat-protocol'

type ContentPart = Exclude<ThreadMessageLike['content'], string>[number]
type ToolCallPart = Extract<ContentPart, { type: 'tool-call' }>
type Step = NonNullable<NonNullable<ThreadMessageLike['metadata']>['steps']>[number]

type TranscriptItem = {
  message: Message
  entry?: EntryRecord
  live?: boolean
}

type AssistantGroup = {
  firstIndex: number
  lastIndex: number
  parts: ContentPart[]
  steps: Step[]
  last: AssistantMessage
  live: boolean
  pendingApproval: boolean
  pendingTool: boolean
}

export type AgentContextUsage = {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export type AgentProjectionState = {
  snapshot?: SnapshotEvent
  approvals: readonly AgentApproval[]
  queue: readonly InboxItem[]
  epoch?: string
  sequence: number
  contextWindow?: number
}

export type AgentProjectedThread = {
  messages: readonly ThreadMessageLike[]
  transcript: readonly Message[]
  contextUsage?: AgentContextUsage
  compaction: { active: boolean }
  hostUiRequests: readonly never[]
  isRunning: boolean
  queue: { steering: readonly string[]; followUp: readonly string[] }
}

export const emptyDurableProjectionState = (): AgentProjectionState => ({
  approvals: [],
  queue: [],
  sequence: -1,
})

export function reduceDurableFrame(
  current: AgentProjectionState,
  frame: AgentFrame,
): AgentProjectionState {
  if (current.epoch === frame.epoch && frame.sequence <= current.sequence) return current
  if (frame.type === 'reset' || frame.epoch !== current.epoch) {
    const snapshot = frame.events.find((event): event is SnapshotEvent => event.type === 'snapshot')
    if (!snapshot) throw new Error('Snapshot required for event reset')
    return {
      snapshot,
      approvals: frame.approvals,
      queue: frame.queue,
      epoch: frame.epoch,
      sequence: frame.sequence,
      contextWindow: frame.contextWindow,
    }
  }
  if (frame.sequence !== current.sequence + 1) throw new Error('Agent event sequence gap')
  return {
    snapshot: current.snapshot ? applyEvents(current.snapshot, frame.events) : undefined,
    approvals: frame.approvals,
    queue: frame.queue,
    epoch: frame.epoch,
    sequence: frame.sequence,
    contextWindow: frame.contextWindow ?? current.contextWindow,
  }
}

export function projectDurableThread(state: AgentProjectionState): AgentProjectedThread {
  const snapshot = state.snapshot
  if (!snapshot) {
    return {
      messages: [],
      transcript: [],
      compaction: { active: false },
      hostUiRequests: [],
      isRunning: false,
      queue: { steering: [], followUp: [] },
    }
  }
  const transcriptItems = snapshotToTranscript(snapshot)
  const transcript = transcriptItems.map((item) => item.message)
  const messages = projectTranscript(transcriptItems, snapshot, state.approvals)
  return {
    messages,
    transcript,
    contextUsage: snapshotContextUsage(snapshot, state.contextWindow),
    compaction: { active: snapshot.compactions.length > 0 },
    hostUiRequests: [],
    isRunning: isSnapshotRunning(snapshot),
    queue: queueText(state.queue),
  }
}

function applyEvents(snapshot: SnapshotEvent, events: readonly AgentEvent[]): SnapshotEvent {
  return events.reduce<SnapshotEvent>((current, event) => applyEvent(current, event), snapshot)
}

function applyEvent(snapshot: SnapshotEvent, event: AgentEvent): SnapshotEvent {
  switch (event.type) {
    case 'snapshot':
      return event
    case 'run_start':
      return { ...snapshot, run: { inputs: event.inputs } }
    case 'run_end':
      return { ...snapshot, run: undefined, generation: undefined, tools: [] }
    case 'message_start':
      return event.message.role === 'assistant'
        ? { ...snapshot, generation: { attempt: snapshot.generation?.attempt ?? 1, message: event.message } }
        : snapshot
    case 'message_update': {
      const message = snapshot.generation?.message
      if (!message) return snapshot
      return {
        ...snapshot,
        generation: {
          ...snapshot.generation,
          attempt: snapshot.generation?.attempt ?? 1,
          message: applyMessageChanges({ ...message, usage: event.usage }, event.changes),
        },
      }
    }
    case 'message_end':
      return {
        ...snapshot,
        entries: upsertEntry(snapshot.entries, event.entry),
        generation: snapshot.generation ? { ...snapshot.generation, message: undefined } : undefined,
      }
    case 'entry_appended':
      return { ...snapshot, entries: upsertEntry(snapshot.entries, event.entry) }
    case 'tool_execution_start':
      return {
        ...snapshot,
        tools: upsertTool(snapshot.tools, {
          callId: event.toolCallId,
          name: event.toolName,
          status: 'running',
          output: '',
          details: {},
          diagnostics: [],
        }),
      }
    case 'tool_execution_update':
      return {
        ...snapshot,
        tools: upsertTool(
          snapshot.tools,
          mergeTool(snapshot.tools.find((tool) => tool.callId === event.toolCallId), event),
        ),
      }
    case 'tool_execution_end':
      return {
        ...snapshot,
        tools: upsertTool(snapshot.tools, {
          ...(snapshot.tools.find((tool) => tool.callId === event.toolCallId) ?? {
            callId: event.toolCallId,
            name: event.toolName,
          }),
          status: 'done',
          entry: event.entry?.id,
        }),
        entries: event.entry ? upsertEntry(snapshot.entries, event.entry) : snapshot.entries,
      }
    case 'agent_changed':
      return { ...snapshot, agent: event.agent }
    case 'usage_changed':
      return { ...snapshot, usage: event.usage }
    case 'compaction_start':
      return {
        ...snapshot,
        compactions: upsertCompaction(snapshot.compactions, {
          taskId: event.taskId as SnapshotEvent['compactions'][number]['taskId'],
          reason: event.reason,
          blocking: event.blocking,
          attempt: 1,
        }),
      }
    case 'compaction_end':
      return {
        ...snapshot,
        compactions: snapshot.compactions.filter((item) => item.taskId !== event.taskId),
      }
    default:
      return snapshot
  }
}

function upsertEntry(entries: readonly EntryRecord[], entry: EntryRecord): readonly EntryRecord[] {
  return entries.some((item) => item.id === entry.id)
    ? entries.map((item) => (item.id === entry.id ? entry : item))
    : [...entries, entry]
}

function upsertTool<T extends { callId: string }>(tools: readonly T[], tool: T): readonly T[] {
  return tools.some((item) => item.callId === tool.callId)
    ? tools.map((item) => (item.callId === tool.callId ? tool : item))
    : [...tools, tool]
}

function mergeTool(
  current: SnapshotEvent['tools'][number] | undefined,
  event: Extract<AgentEvent, { type: 'tool_execution_update' }>,
): SnapshotEvent['tools'][number] {
  const previous = current ?? { callId: event.toolCallId, name: event.toolName, status: 'running' as const }
  const output = event.output
    ? 'set' in event.output
      ? event.output.set
      : `${previous.output ?? ''}${event.output.append ?? ''}`
    : previous.output
  return {
    ...previous,
    status: previous.status === 'done' ? 'done' : 'running',
    output,
    details: event.details ?? previous.details,
    diagnostics: event.diagnostics ? [...event.diagnostics] : previous.diagnostics,
  }
}

function upsertCompaction<T extends { taskId: unknown }>(items: readonly T[], item: T): readonly T[] {
  return items.some((current) => current.taskId === item.taskId)
    ? items.map((current) => (current.taskId === item.taskId ? item : current))
    : [...items, item]
}

function applyMessageChanges(
  message: AssistantMessage,
  changes: Extract<AgentEvent, { type: 'message_update' }>['changes'],
): AssistantMessage {
  let content = [...message.content]
  for (const change of changes) {
    if (change.type === 'message') {
      return change.message
    }
    if (change.type === 'block' || change.type === 'text_start' || change.type === 'thinking_start' || change.type === 'toolcall_start') {
      content = setAt(content, change.contentIndex, change.block)
    } else if (change.type === 'text_delta') {
      const block = content[change.contentIndex]
      if (block?.type === 'text') content = setAt(content, change.contentIndex, { ...block, text: block.text + change.delta })
    } else if (change.type === 'thinking_delta') {
      const block = content[change.contentIndex]
      if (block?.type === 'thinking') content = setAt(content, change.contentIndex, { ...block, thinking: block.thinking + change.delta })
    }
  }
  return { ...message, content }
}

function setAt<T>(items: readonly T[], index: number, item: T): T[] {
  const next = [...items]
  next[index] = item
  return next
}

function snapshotToTranscript(snapshot: SnapshotEvent): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const entry of snapshot.entries) {
    if (isCompactionEntry(entry)) {
      items.push({ message: compactionMessage(entry), entry })
      continue
    }
    for (const message of entry.model ?? []) items.push({ message, entry })
  }
  if (snapshot.generation?.message) items.push({ message: snapshot.generation.message, live: true })
  return items
}

function isCompactionEntry(entry: EntryRecord): boolean {
  return entry.kind.toLowerCase().includes('compaction')
}

function compactionMessage(entry: EntryRecord): AssistantMessage {
  const text = entry.model?.flatMap((message) => contentText(message)).join('\n') ?? ''
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'pi-messages',
    provider: 'system',
    model: 'compaction',
    usage: zeroUsage(),
    stopReason: 'stop',
    timestamp: entryTimestamp(entry),
  }
}

function projectTranscript(
  items: readonly TranscriptItem[],
  snapshot: SnapshotEvent,
  approvals: readonly AgentApproval[],
): ThreadMessageLike[] {
  const toolResults = buildToolResults(items, snapshot)
  const approvalByCall = new Map(approvals.map((approval) => [approval.callId, approval]))
  const output: ThreadMessageLike[] = []
  let group: AssistantGroup | null = null
  const flush = () => {
    if (!group) return
    output.push(buildAssistant(group, snapshot, items, output.length))
    group = null
  }
  items.forEach((item, index) => {
    const { message } = item
    if (message.role === 'toolResult') return
    if (message.role === 'assistant') {
      if (!group) {
        group = {
          firstIndex: index,
          lastIndex: index,
          parts: [],
          steps: [],
          last: message,
          live: item.live === true,
          pendingApproval: false,
          pendingTool: false,
        }
      }
      group.lastIndex = index
      group.last = message
      group.live = group.live || item.live === true
      const parentId = `durable-step:${index}`
      group.steps.push({
        messageId: parentId,
        usage: { inputTokens: message.usage.input, outputTokens: message.usage.output },
      })
      for (const part of message.content) {
        if (part.type === 'text') group.parts.push({ type: 'text', text: part.text, parentId })
        else if (part.type === 'thinking') group.parts.push({ type: 'reasoning', text: part.redacted ? '[reasoning redacted]' : part.thinking, parentId })
        else if (part.type === 'toolCall') {
          const tool = toolResults.get(part.id)
          const approval = approvalByCall.get(part.id)
          if (approval?.state === 'pending') group.pendingApproval = true
          if (!tool?.complete && isSnapshotRunning(snapshot)) group.pendingTool = true
          group.parts.push(toolCallPart(part, parentId, tool, approval))
        }
      }
      return
    }
    flush()
    if (message.role === 'user') {
      output.push({
        id: `durable-msg:${index}`,
        role: 'user',
        createdAt: new Date(message.timestamp),
        content: userContent(message.content),
      })
    } else {
      output.push({
        id: `durable-msg:${index}`,
        role: 'assistant',
        createdAt: new Date(message.timestamp),
        content: [{ type: 'data', name: 'durable-system-message', data: { message } }],
      })
    }
  })
  flush()
  return output
}

function buildAssistant(
  group: AssistantGroup,
  snapshot: SnapshotEvent,
  items: readonly TranscriptItem[],
  outputIndex: number,
): ThreadMessageLike {
  const entry = items[group.lastIndex]?.entry
  const isCompaction = entry ? isCompactionEntry(entry) : false
  return {
    id: `durable-msg:${group.firstIndex}`,
    role: 'assistant',
    createdAt: new Date(group.last.timestamp),
    content: isCompaction
      ? [{ type: 'data', name: 'pi-compaction-summary', data: { summary: contentText(group.last) } }]
      : group.parts,
    status: assistantStatus(group, snapshot),
    metadata: {
      steps: group.steps,
      custom: {
        durable: {
          entryId: entry?.id,
          provider: group.last.provider,
          model: group.last.model,
          usage: group.last.usage,
          stopReason: group.last.stopReason,
        },
        ...(entry?.byTaskId ? { runId: String(entry.byTaskId) } : {}),
        outputIndex,
      },
    },
  }
}

function assistantStatus(
  group: {
    last: AssistantMessage
    live: boolean
    pendingApproval: boolean
    pendingTool: boolean
  },
  snapshot: SnapshotEvent,
): ThreadMessageLike['status'] {
  if (group.pendingApproval) return { type: 'requires-action', reason: 'tool-calls' }
  if (group.live || group.last.stopReason === 'pending' || group.pendingTool) return { type: 'running' }
  if (group.last.stopReason === 'error') return { type: 'incomplete', reason: 'error', error: group.last.errorMessage }
  if (group.last.stopReason === 'aborted') return { type: 'incomplete', reason: 'cancelled' }
  if (group.last.stopReason === 'length') return { type: 'incomplete', reason: 'length' }
  if (isSnapshotRunning(snapshot) && group.last.stopReason === 'toolUse') return { type: 'running' }
  return { type: 'complete', reason: 'stop' }
}

function toolCallPart(
  part: ToolCall,
  parentId: string,
  tool: { result?: unknown; isError?: boolean; complete?: boolean } | undefined,
  approval: AgentApproval | undefined,
): ToolCallPart {
  return {
    type: 'tool-call',
    toolCallId: part.id,
    toolName: part.name,
    args: part.arguments,
    argsText: JSON.stringify(part.arguments),
    parentId,
    ...(tool?.result !== undefined ? { result: tool.result } : {}),
    ...(tool?.isError ? { isError: true } : {}),
    ...(approval
      ? {
          approval: {
            id: approval.id,
            ...(approval.state === 'approved'
              ? { approved: true }
              : approval.state === 'rejected'
                ? { approved: false }
                : {}),
          },
        }
      : {}),
  }
}

function buildToolResults(items: readonly TranscriptItem[], snapshot: SnapshotEvent) {
  const results = new Map<string, { result?: unknown; isError?: boolean; complete?: boolean }>()
  for (const item of items) {
    if (item.message.role !== 'toolResult') continue
    const message = item.message as ToolResultMessage
    results.set(message.toolCallId, {
      result: {
        content: message.content,
        details: message.details ?? item.entry?.data,
        diagnostics: diagnostics(item.entry?.data),
        usage: message.usage,
        nestedCalls: message.nestedCalls,
      },
      isError: message.isError,
      complete: true,
    })
  }
  for (const tool of snapshot.tools) {
    if (results.has(tool.callId) && tool.status === 'done') continue
    results.set(tool.callId, {
      result:
        tool.output !== undefined || tool.details !== undefined || tool.diagnostics !== undefined
          ? {
              content: tool.output ? [{ type: 'text', text: tool.output }] : [],
              details: tool.details,
              diagnostics: tool.diagnostics,
            }
          : undefined,
      complete: tool.status === 'done',
    })
  }
  return results
}

function diagnostics(data: unknown): unknown {
  if (!data || typeof data !== 'object') return undefined
  return (data as { diagnostics?: unknown }).diagnostics
}

function userContent(content: string | readonly ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]): ContentPart[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', image: part.data.startsWith('data:') ? part.data : `data:${part.mimeType};base64,${part.data}` },
  )
}

function contentText(message: Message): string {
  const content = message.content
  if (typeof content === 'string') return content
  return content
    .map((part) => (part.type === 'text' ? part.text : part.type === 'thinking' ? part.thinking : ''))
    .filter(Boolean)
    .join('\n')
}

function queueText(queue: readonly InboxItem[]) {
  const text = (content: Exclude<InboxItem, { mode: 'write' }>['content']) =>
    typeof content === 'string'
      ? content
      : content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n')
  return {
    steering: queue.filter((item): item is Exclude<InboxItem, { mode: 'write' }> => item.mode === 'steer').map((item) => text(item.content)),
    followUp: queue.filter((item): item is Exclude<InboxItem, { mode: 'write' }> => item.mode === 'followUp').map((item) => text(item.content)),
  }
}

export function snapshotContextUsage(snapshot: SnapshotEvent, contextWindow = 0): AgentContextUsage {
  const messages = snapshot.entries.flatMap((entry) => entry.model ?? [])
  const latest = messages.findLast((message) => message.role === 'assistant')
  const tokens = snapshot.generation?.message?.usage.totalTokens ?? (latest?.role === 'assistant' ? latest.usage.totalTokens : null)
  return { tokens, contextWindow, percent: tokens !== null && contextWindow > 0 ? tokens / contextWindow * 100 : null }
}

function isSnapshotRunning(snapshot: SnapshotEvent): boolean {
  return Boolean(snapshot.run || snapshot.generation || snapshot.tools.some((tool) => tool.status !== 'done'))
}

function entryTimestamp(entry: EntryRecord): number {
  return entry.model?.find((message) => 'timestamp' in message)?.timestamp ?? 0
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}
