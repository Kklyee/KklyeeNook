export type AgentRunStatus =
  | 'created'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'interrupted'

export interface AgentRun {
  id: string
  sessionId: string
  status: AgentRunStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  error?: string
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
}

export interface LoadAgentRunsRequest {
  sessionId: string
}
import type { ToolCall, ToolResult } from '../tool/tool'
