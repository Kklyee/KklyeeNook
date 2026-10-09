import type { PermissionMode } from '../approval/permission'
import type { RemoteFileAttachment } from './attachments'
export type { RemoteFileAttachment } from './attachments'

export type RemotePermissionMode = PermissionMode
export interface RemoteSettings {
  enabled: boolean
  allowedLogin?: string
}
export interface RemoteStatus extends RemoteSettings {
  running: boolean
  tailscale: 'connected' | 'disconnected' | 'unavailable'
  url?: string
  ownerLogin?: string
  error?: string
}
export interface RemoteProject {
  id: string
  name: string
  conversationCount: number
  activeRunCount: number
  updatedAt?: number
}
export interface RemoteModel {
  provider: string
  modelId: string
  name: string
  supportsThinking: boolean
  thinkingLevels: string[]
  contextWindow?: number
}
export interface RemoteConversationSummary {
  id: string
  projectId: string
  title: string
  status: 'idle' | 'running' | 'failed'
  updatedAt: number
}
export interface RemoteMessage {
  id: string
  role: 'user' | 'assistant'
  timestamp: number
  content: Array<{ type: 'text'; text: string } | { type: 'reasoning'; text: string } | {
    type: 'image'
    image: string
  } | { type: 'data'; name: 'tool-call'; data: { toolCallId: string } }>
  status?: 'running' | 'complete' | 'failed' | 'cancelled'
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }
}
export interface RemoteActivity {
  id: string
  label: string
  status: 'running' | 'completed' | 'failed' | 'waiting'
  detail?: string
  startedAt?: number
  endedAt?: number
  type: string
  runId: string
  runCreatedAt: number
  runCompletedAt?: number
  textOffset: number
  toolCallId?: string
  summary: string
}
export interface RemoteQueueItem {
  id: string
  text: string
  steer: boolean
  index: number
  expected: string[]
}
export type RemoteQueueMutation = {
  mode: 'steer' | 'followUp'
  expected: string[]
  index: number
} & (
  | { action: 'remove' }
  | { action: 'steer' }
  | { action: 'edit'; value: string }
  | { action: 'move'; value: number }
)
export type RemoteApproval = {
  id: string
  title: string
  timeoutMs?: number
} & (
  | { kind: 'confirm'; message: string }
  | { kind: 'select'; options: readonly string[] }
  | { kind: 'input'; placeholder?: string }
  | { kind: 'editor'; prefill?: string }
)
export type RemoteApprovalAnswer =
  | { confirmed: boolean }
  | { value: string }
  | { dismissed: true }
export type RemoteApprovalResponse = { conversationId: string } & RemoteApprovalAnswer
export interface RemoteContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}
export interface RemoteConversationSnapshot extends RemoteConversationSummary {
  contextUsage?: RemoteContextUsage
  permission: RemotePermissionMode
  model?: { provider: string; modelId: string }
  thinkingLevel: string
  messages: RemoteMessage[]
  activities: RemoteActivity[]
  queue: RemoteQueueItem[]
  approvals: RemoteApproval[]
  error?: string
}
export interface RemoteCreateConversationInput {
  permission: RemotePermissionMode
  provider: string
  modelId: string
  thinkingLevel: string
  prompt: string
  attachments?: RemoteFileAttachment[]
}
export interface RemoteSendMessageInput {
  content: string
  mode: 'normal' | 'followUp' | 'steer'
  attachments?: RemoteFileAttachment[]
}
export interface RemoteState {
  models: RemoteModel[]
  permissions: RemotePermissionMode[]
  defaults: Omit<RemoteCreateConversationInput, 'prompt' | 'attachments'>
}
export type RemoteEventBody =
  | { type: 'snapshot'; snapshot: RemoteConversationSnapshot }
  | { type: 'message'; message: RemoteMessage }
  | { type: 'activity'; activities: RemoteActivity[] }
  | { type: 'context'; contextUsage: RemoteContextUsage }
  | { type: 'queue'; queue: RemoteQueueItem[] }
  | { type: 'approvals'; approvals: RemoteApproval[] }
  | { type: 'status'; status: RemoteConversationSummary['status'] }
  | { type: 'error'; error: string }
export type RemoteEvent = RemoteEventBody & { seq: number }
