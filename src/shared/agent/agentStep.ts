import type { AgentExecutionRecord } from './agentExecutionRecord'

export type StepResult = 'committed' | 'aborted'

export interface AgentStepTrace {
  id: string
  ordinal: number
  piTurnIndex: number
  startedSeq: number
  endedSeq?: number
  result?: StepResult
  interrupted?: boolean
  events: AgentExecutionRecord[]
}
