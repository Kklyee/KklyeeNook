import type { PetState } from "@/shared/pet/petState";

import type { AgentEvent } from "@/shared/agent/agentEvent";

export function reducePetState(state: PetState, event: AgentEvent): PetState {
  switch (event.type) {
    case "agent_started":
      return {
        ...state,
        activity: "thinking",
        currentTool: undefined,
      };

    case "tool_started":
      return {
        ...state,
        activity: "working",
        currentTool: event.tool,
      };

    case "tool_finished":
      return {
        ...state,
        activity: "thinking",
        currentTool: undefined,
      };

    case "approval_required":
      return {
        ...state,
        activity: "waiting",
        message: event.message,
      };

    case "agent_completed":
      return {
        ...state,
        activity: "success",
        currentTool: undefined,
      };

    case "agent_failed":
      return {
        ...state,
        activity: "error",
        currentTool: undefined,
        message: event.error,
      };

    case "agent_aborted":
      return {
        ...state,
        activity: "idle",
        currentTool: undefined,
      };
  }
}
