import type { ToolCall, ToolResult } from '../tool/tool'

export type AgentEvent =
  | { type: 'user_message'; text: string }
  | { type: 'system_prompt'; text: string }
  | { type: 'agent_started' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_started'; call: ToolCall }
  | { type: 'tool_updated'; toolCallId: string; partialResult: unknown }
  | { type: 'tool_finished'; result: ToolResult }
  | {
      type: 'approval_required'
      approvalId: string
      call: ToolCall
    }
  | {
      type: 'approval_resolved'
      approvalId: string
      toolCallId: string
      decision: 'allow' | 'deny'
    }
  | { type: 'agent_completed' }
  | { type: 'agent_failed'; error: string }
  | { type: 'agent_aborted' }
