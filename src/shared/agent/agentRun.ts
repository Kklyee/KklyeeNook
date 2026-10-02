import type { AgentPlan } from './agentPlan'
import type { ToolCall, ToolResult } from '../tool/tool'
import type { SubagentAvatar } from './delegateTask'

export type AgentRunStatus =
  | 'created'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'interrupted'

export type AgentRunOverviewStatus = AgentRunStatus | 'idle'

export interface AgentRunOverview {
  sessionId: string
  sessionTitle?: string
  runId?: string
  scheduledTaskId?: string
  status: AgentRunOverviewStatus
  startedAt?: number
  completedAt?: number
  updatedAt: number
}

export interface AgentRun {
  workspaceId?: string | null
  id: string
  sessionId: string
  displayName?: string
  avatar?: SubagentAvatar
  parentRunId?: string
  rootRunId?: string
  depth?: number
  scheduledTaskId?: string
  status: AgentRunStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  error?: string
  result?: string
  plan?: AgentPlan
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
}

export interface LoadAgentRunsRequest {
  sessionId: string
}
