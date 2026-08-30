import { initialPetState, type PetState } from "@/shared/pet/petState";

import type { AgentEvent } from "@/shared/agent/agentEvent";

import { reducePetState } from "./petStateMachine";

export class PetRuntime {
  private state: PetState = initialPetState;

  constructor(private onStateChange: (state: PetState) => void) {}

  dispatch(event: AgentEvent) {
    this.state = reducePetState(this.state, event);
    this.onStateChange(this.state);
  }

  getState() {
    return this.state;
  }
}
