// Agent event types go here.
export type AgentEvent =
  | {
      type: "agent_started";
    }
  | {
      type: "tool_started";
      tool: string;
    }
  | {
      type: "tool_finished";
      tool: string;
    }
  | {
      type: "approval_required";
      message?: string;
    }
  | {
      type: "agent_completed";
    }
  | {
      type: "agent_failed";
      error?: string;
    }
  | {
      type: "agent_aborted";
    };
