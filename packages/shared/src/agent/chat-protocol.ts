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
  contextWindow?: number
  events: readonly AgentEvent[]
  approvals: readonly AgentApproval[]
  queue: readonly InboxItem[]
}

export type AgentThreadSummary = {
  id: string
  title?: string
  createdAt?: number
  updatedAt?: number
  workspaceId?: string | null
  permissionMode?: string | null
  archived?: boolean
  historical?: boolean
  activeRunId?: string
  model?: { provider: string; modelId: string }
  thinkingLevel?: ModelThinkingLevel
}

export type HistoryRecord = { id: string; role: string; kind: string; createdAt: number; payload: unknown }

export type AgentThreadSnapshot = {
  contextWindow?: number
  snapshot: SnapshotEvent
  approvals: readonly AgentApproval[]
  queue: readonly InboxItem[]
  metadata?: AgentThreadSummary
  historical?: boolean
  history?: readonly HistoryRecord[]
}

export type AgentSubmissionInput = {
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
  mode: 'steer' | 'followUp'
  expected: string[]
  index: number
  action: 'remove' | 'edit' | 'move' | 'steer'
  value?: string | number
}
