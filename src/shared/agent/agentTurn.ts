import type { AgentStepTrace } from './agentStep'

export type TurnEndReason = 'completed' | 'next_input' | 'failed' | 'aborted' | 'interrupted'

export interface AgentTurnTrace {
  id: string
  ordinal: number
  inputIds: string[]
  startedSeq: number
  endedSeq?: number
  reason?: TurnEndReason
  steps: AgentStepTrace[]
}
