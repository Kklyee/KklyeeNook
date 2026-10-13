import type {
  AgentEvent,
  InboxItem,
  JsonObject,
  SnapshotEvent,
  TaskId,
} from '@earendil-works/pi-durable'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'

export type ApprovalRequirement = { request: JsonObject; reason: string }

export type AgentApproval = ApprovalRequirement & {
  id: string
  taskId: TaskId
  callId: string
  toolName: string
  arguments: JsonObject
  state: 'pending' | 'approved' | 'rejected'
  createdAt: number
  decidedAt?: number
}

export type AgentFrame = {
  type: 'reset' | 'events'
  threadId: string
  epoch: string
  sequence: number
  contextUsage?: import('./projection').AgentContextUsage
  contextWindow?: number
  events: readonly AgentEvent[]
  approvals: readonly AgentApproval[]
  queue: readonly InboxItem[]
}

export type AgentThreadSummary = {
  id: string
  botId?: string | null
  title?: string
  createdAt?: number
  updatedAt?: number
  workspaceId?: string | null
  permissionMode?: string | null
  archived?: boolean
  activeRunId?: string
  model?: { provider: string; modelId: string }
  thinkingLevel?: ModelThinkingLevel
}

export type AgentHistoryPage = {
  entries: SnapshotEvent['entries']
  sinceEntry?: number
  hasMore: boolean
}

export type AgentThreadSnapshot = {
  history?: Omit<AgentHistoryPage, 'entries'>
  contextUsage?: import('./projection').AgentContextUsage
  contextWindow?: number
  snapshot: SnapshotEvent
  approvals: readonly AgentApproval[]
  queue: readonly InboxItem[]
  metadata?: AgentThreadSummary
}

export type AgentSubmissionInput = {
  botMentions?: readonly import('../bot/mentions').BotMention[]
  type: 'input'
  requestId: string
  content:
    | string
    | readonly ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  whenBusy?: 'steer' | 'followUp' | 'reject'
  contextAttachmentIds?: readonly string[]
  skillIds?: readonly string[]
}

export type AgentQueueMutation = {
  itemId?: string
  mode: 'steer' | 'followUp'
  expected: string[]
  index: number
  action: 'remove' | 'edit' | 'move' | 'steer'
  value?: string | number
}
