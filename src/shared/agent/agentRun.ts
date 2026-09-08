export type AgentRunStatus = 'created' | 'running' | 'waiting' | 'completed' | 'failed' | 'aborted'

export interface AgentRun {
  id: string
  sessionId: string
  status: AgentRunStatus
  startedAt?: number
  completedAt?: number
  error?: string
}
