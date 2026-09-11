import type { AgentEvent } from './agentEvent'

export interface AgentExecutionRecord {
  id: number
  sessionId: string
  runId: string
  timestamp: number
  event: AgentEvent
}

export interface LoadAgentExecutionRecordsRequest {
  runId: string
}
