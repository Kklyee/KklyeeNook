import type { AgentEvent } from '@kklyeenook/shared/agent/agentEvent'
import type { AgentStepTrace } from '@kklyeenook/shared/agent/agentStep'

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
