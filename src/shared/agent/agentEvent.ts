import type { AgentPlan } from './agentPlan'
import type { ToolCall, ToolResult } from '../tool/tool'
import type { StepResult } from './agentStep'
import type { AgentContextUsage } from './agentContextUsage'

export type InputDelivery = 'initial' | 'steer' | 'follow-up'

export type AgentEvent =
  | { type: 'user_message'; inputId: string; delivery: InputDelivery; text: string }
  | { type: 'step_started'; stepId: string; ordinal: number; piTurnIndex: number; acceptedInputIds: string[] }
  | { type: 'step_ended'; stepId: string; result: StepResult }
  | { type: 'system_prompt'; text: string }
  | { type: 'agent_started' }
  | { type: 'inference_started' }
  | { type: 'inference_finished'; failed: boolean }
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_started'; call: ToolCall }
  | { type: 'tool_updated'; toolCallId: string; partialResult: unknown }
  | { type: 'tool_finished'; result: ToolResult }
  | { type: 'plan_updated'; plan: AgentPlan }
  | { type: 'context_usage_updated'; usage: AgentContextUsage; source: 'step' | 'compaction' }
  | {
      type: 'context_compaction_started'
      reason: 'manual' | 'threshold' | 'overflow'
      tokensBefore?: number
      contextWindow?: number
    }
  | {
      type: 'context_compaction_completed'
      reason: 'manual' | 'threshold' | 'overflow'
      tokensBefore?: number
      estimatedTokensAfter?: number
      contextWindow?: number
    }
  | {
      type: 'context_compaction_failed'
      reason: 'manual' | 'threshold' | 'overflow'
      error: string
      tokensBefore?: number
      contextWindow?: number
    }
  | { type: 'approval_required'; approvalId: string; call: ToolCall }
  | {
      type: 'approval_resolved'
      approvalId: string
      toolCallId: string
      decision: 'allow' | 'deny'
    }
  | { type: 'agent_completed' }
  | { type: 'agent_failed'; error: string }
  | { type: 'agent_aborted' }
