import type { AgentEvent, InboxItem, JsonObject, TaskId } from '@earendil-works/pi-durable'

export type ApprovalRequirement = { request: JsonObject; reason: string }

export type DurableApproval = ApprovalRequirement & {
  id: string
  taskId: TaskId
  callId: string
  toolName: string
  arguments: JsonObject
  state: 'pending' | 'approved' | 'rejected'
  createdAt: number
  decidedAt?: number
}

export type DurableFrame = {
  type: 'reset' | 'events'
  threadId: string
  epoch: string
  sequence: number
  events: readonly AgentEvent[]
  approvals: readonly DurableApproval[]
  queue: readonly InboxItem[]
}
