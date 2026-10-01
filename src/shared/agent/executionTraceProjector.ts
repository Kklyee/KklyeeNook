import type { AgentExecutionRecord, AgentRunTrace } from './agentExecutionRecord'
import type { AgentRun } from './agentRun'
import type { AgentTurnTrace } from './agentTurn'
import type { AgentStepTrace } from './agentStep'

export class ExecutionTraceProjector {
  project(
    run: Pick<AgentRun, 'id' | 'status'>,
    records: readonly AgentExecutionRecord[],
  ): AgentRunTrace {
    const turns = new Map<string, AgentTurnTrace>()
    const steps = new Map<string, AgentStepTrace>()
    const ordered = [...records].sort((a, b) => a.seq - b.seq)

    for (const record of ordered) {
      const event = record.event
      switch (event.type) {
        case 'turn_started':
          turns.set(event.turnId, {
            id: event.turnId,
            ordinal: event.ordinal,
            inputIds: [...event.inputIds],
            startedSeq: record.seq,
            steps: [],
          })
          break
        case 'turn_ended': {
          const turn = turns.get(event.turnId)
          if (turn) {
            turn.endedSeq = record.seq
            turn.reason = event.reason
          }
          break
        }
        case 'step_started': {
          const turn = turns.get(event.turnId)
          if (!turn) break
          const step: AgentStepTrace = {
            id: event.stepId,
            ordinal: event.ordinal,
            piTurnIndex: event.piTurnIndex,
            startedSeq: record.seq,
            events: [],
          }
          turn.steps.push(step)
          steps.set(step.id, step)
          break
        }
        case 'step_ended': {
          const step = steps.get(event.stepId)
          if (step) {
            step.endedSeq = record.seq
            step.result = event.result
          }
          break
        }
      }
      if (record.stepId) steps.get(record.stepId)?.events.push(record)
    }

    if (run.status === 'interrupted') {
      for (const turn of turns.values()) {
        if (turn.endedSeq === undefined) turn.reason = 'interrupted'
        for (const step of turn.steps) {
          if (step.endedSeq === undefined) step.interrupted = true
        }
      }
    }

    const claimedInputs = new Set([...turns.values()].flatMap((turn) => turn.inputIds))
    const unscopedEvents = ordered.filter((record) => {
      if (
        record.stepId ||
        ['turn_started', 'turn_ended', 'step_started', 'step_ended'].includes(record.event.type)
      )
        return false
      return record.event.type !== 'user_message' || !claimedInputs.has(record.event.inputId)
    })
    return { runId: run.id, turns: [...turns.values()], unscopedEvents }
  }
}
