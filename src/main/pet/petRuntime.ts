import { type PetState } from '@/shared/pet/petState'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import { reducePetState } from './petStateMachine'

const initialPetState: PetState = { activity: 'idle' }

export class PetRuntime {
  private state: PetState = initialPetState

  constructor(private onStateChange: (state: PetState) => void) {}

  dispatch(event: AgentEvent) {
    this.state = reducePetState(this.state, event)
    this.onStateChange(this.state)
  }

  getState() {
    return this.state
  }
}
