import type { AgentEvent } from './agentEvent'
import type { AgentStepTrace } from './agentStep'

export interface AgentEventEnvelope {
  sessionId: string
  runId: string
  seq: number
  stepId?: string
  timestamp: number
  event: AgentEvent
}

export interface AgentExecutionRecord extends AgentEventEnvelope {
  id: number
}

export interface AgentRunTrace {
  runId: string
  steps: AgentStepTrace[]
  unscopedEvents: AgentExecutionRecord[]
}

export interface LoadAgentExecutionRecordsRequest {
  runId: string
}
