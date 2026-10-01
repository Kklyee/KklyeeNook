import { randomUUID } from 'node:crypto'
import type { AgentEvent, InputDelivery } from '@/shared/agent/agentEvent'
import type { StepResult } from '@/shared/agent/agentStep'
import type { TurnEndReason } from '@/shared/agent/agentTurn'

interface PendingInput {
  inputId: string
  delivery: InputDelivery
}

export class ExecutionBoundaryTracker {
  private nextTurnOrdinal = 1
  private nextStepOrdinal = 1
  private activeTurn?: { id: string; ordinal: number; inputIds: string[] }
  private activeStep?: { id: string; ordinal: number; piTurnIndex: number }
  private pendingInputs: PendingInput[] = []

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get correlation(): { turnId?: string; stepId?: string } {
    return { turnId: this.activeTurn?.id, stepId: this.activeStep?.id }
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
    if (inputs.length && this.activeTurn) {
      this.closeTurn(
        inputs.some((input) => input.delivery === 'follow-up') ? 'completed' : 'next_input',
      )
    }
    if (!this.activeTurn) {
      if (!inputs.length) throw new Error('A Turn requires an accepted user input')
      const turn = {
        id: randomUUID(),
        ordinal: this.nextTurnOrdinal++,
        inputIds: inputs.map((input) => input.inputId),
      }
      this.activeTurn = turn
      this.nextStepOrdinal = 1
      this.emit({
        type: 'turn_started',
        turnId: turn.id,
        ordinal: turn.ordinal,
        inputIds: turn.inputIds,
      })
    }
    const step = { id: randomUUID(), ordinal: this.nextStepOrdinal++, piTurnIndex }
    this.activeStep = step
    this.emit({
      type: 'step_started',
      stepId: step.id,
      turnId: this.activeTurn.id,
      ordinal: step.ordinal,
      piTurnIndex,
    })
  }

  onPiTurnEnd(result: StepResult): void {
    if (!this.activeStep) return
    this.emit({
      type: 'step_ended',
      stepId: this.activeStep.id,
      turnId: this.activeTurn!.id,
      result,
    })
    this.activeStep = undefined
  }

  onSettled(): boolean {
    if (this.hasPendingInputs) return false
    this.closeTurn('completed')
    return true
  }

  terminate(reason: 'failed' | 'aborted'): void {
    this.onPiTurnEnd('aborted')
    this.closeTurn(reason)
    this.pendingInputs = []
  }

  private closeTurn(reason: TurnEndReason): void {
    if (!this.activeTurn) return
    this.emit({ type: 'turn_ended', turnId: this.activeTurn.id, reason })
    this.activeTurn = undefined
  }
}
