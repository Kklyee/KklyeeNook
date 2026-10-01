import { randomUUID } from 'node:crypto'
import type { AgentEvent, InputDelivery } from '@/shared/agent/agentEvent'
import type { StepResult } from '@/shared/agent/agentStep'

interface PendingInput {
  inputId: string
  delivery: InputDelivery
}

export class ExecutionBoundaryTracker {
  private nextStepOrdinal = 1
  private activeStep?: { id: string; ordinal: number; piTurnIndex: number; acceptedInputIds: string[] }
  private pendingInputs: PendingInput[] = []

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get correlation(): { stepId?: string } {
    return { stepId: this.activeStep?.id }
  }

  get hasPendingInputs(): boolean {
    return this.pendingInputs.length > 0
  }

  enqueue(input: PendingInput): void {
    this.pendingInputs.push(input)
  }

  discard(inputId?: string): void {
    this.pendingInputs = inputId
      ? this.pendingInputs.filter((input) => input.inputId !== inputId)
      : this.pendingInputs.filter((input) => input.delivery === 'initial')
  }

  onPiTurnStart(piTurnIndex: number, deliveries: readonly InputDelivery[]): void {
    if (this.activeStep) throw new Error('A Step is already active')
    const pending = [...this.pendingInputs]
    const inputs = deliveries.map((delivery) => {
      const index = pending.findIndex((input) => input.delivery === delivery)
      if (index === -1) throw new Error(`No pending ${delivery} input`)
      return pending.splice(index, 1)[0]!
    })
    this.pendingInputs = pending
    const step = {
      id: randomUUID(),
      ordinal: this.nextStepOrdinal++,
      piTurnIndex,
      acceptedInputIds: inputs.map((input) => input.inputId),
    }
    this.activeStep = step
    this.emit({
      type: 'step_started',
      stepId: step.id,
      ordinal: step.ordinal,
      piTurnIndex,
      acceptedInputIds: step.acceptedInputIds,
    })
  }

  onPiTurnEnd(result: StepResult): void {
    if (!this.activeStep) return
    this.emit({
      type: 'step_ended',
      stepId: this.activeStep.id,
      result,
    })
    this.activeStep = undefined
  }

  canSettleRun(): boolean {
    return !this.hasPendingInputs
  }

  terminate(): void {
    this.onPiTurnEnd('aborted')
    this.pendingInputs = []
  }
}
