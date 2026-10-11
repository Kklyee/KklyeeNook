import type { AgentExecutionRecord } from '@kklyeenook/shared/agent/agentExecutionRecord'

export type StepResult = 'committed' | 'aborted'

export interface AgentStepTrace {
  id: string
  ordinal: number
  piTurnIndex: number
  acceptedInputIds: string[]
  startedSeq: number
  endedSeq?: number
  result?: StepResult
  interrupted?: boolean
  events: AgentExecutionRecord[]
}
