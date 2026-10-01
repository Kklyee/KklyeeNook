import type { AgentEvent } from './agentEvent'
import type { AgentTurnTrace } from './agentTurn'

export interface AgentEventEnvelope {
  sessionId: string
  runId: string
  seq: number
  turnId?: string
  stepId?: string
  timestamp: number
  event: AgentEvent
}

export interface AgentExecutionRecord extends AgentEventEnvelope {
  id: number
}

export interface AgentRunTrace {
  runId: string
  turns: AgentTurnTrace[]
  unscopedEvents: AgentExecutionRecord[]
}

export interface LoadAgentExecutionRecordsRequest {
  runId: string
}
