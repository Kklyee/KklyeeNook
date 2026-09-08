export type AgentEvent =
  | { type: 'agent_started' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_started'; toolCallId: string; tool: string; args: unknown }
  | { type: 'tool_updated'; toolCallId: string; tool: string; partialResult: unknown }
  | { type: 'tool_finished'; toolCallId: string; tool: string; result: unknown; success: boolean }
  | {
      type: 'approval_required'
      approvalId: string
      toolCallId: string
      tool: string
      args: unknown
    }
  | { type: 'agent_completed' }
  | { type: 'agent_failed'; error: string }
  | { type: 'agent_aborted' }
