export type AgentEvent =
  | { type: 'agent_started' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_started'; tool: string }
  | { type: 'tool_finished'; tool: string; success: boolean }
  | { type: 'approval_required'; message?: string }
  | { type: 'agent_completed' }
  | { type: 'agent_failed'; error: string }
  | { type: 'agent_aborted' };
