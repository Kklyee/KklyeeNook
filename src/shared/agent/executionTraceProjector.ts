import type { AgentExecutionRecord, AgentRunTrace } from './agentExecutionRecord'
import type { AgentRun } from './agentRun'
import type { AgentStepTrace } from './agentStep'

export class ExecutionTraceProjector {
  project(
    run: Pick<AgentRun, 'id' | 'status'>,
    records: readonly AgentExecutionRecord[],
  ): AgentRunTrace {
    const steps = new Map<string, AgentStepTrace>()
    const ordered = [...records].sort((a, b) => a.seq - b.seq)

    for (const record of ordered) {
      const event = record.event
      switch (event.type) {
        case 'step_started': {
          const step: AgentStepTrace = {
            id: event.stepId,
            ordinal: event.ordinal,
            piTurnIndex: event.piTurnIndex,
            acceptedInputIds: [...event.acceptedInputIds],
            startedSeq: record.seq,
            events: [],
          }
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
      for (const step of steps.values()) {
        if (step.endedSeq === undefined) step.interrupted = true
      }
    }

    const claimedInputs = new Set([...steps.values()].flatMap((step) => step.acceptedInputIds))
    const unscopedEvents = ordered.filter((record) => {
      if (record.stepId || ['step_started', 'step_ended'].includes(record.event.type))
        return false
      return record.event.type !== 'user_message' || !claimedInputs.has(record.event.inputId)
    })
    return { runId: run.id, steps: [...steps.values()], unscopedEvents }
  }
}
