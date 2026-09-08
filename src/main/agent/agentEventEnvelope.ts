import type { AgentEvent } from '@/shared/agent/agentEvent'

export interface AgentEventEnvelope {
  sessionId: string
  runId: string
  timestamp: number
  event: AgentEvent
}
