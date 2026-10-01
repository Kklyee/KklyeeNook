import type { AgentPlan } from './agentPlan'
import type { ToolCall, ToolResult } from '../tool/tool'
import type { Artifact } from '../artifact/artifact'
import type { TurnEndReason } from './agentTurn'
import type { StepResult } from './agentStep'

export type InputDelivery = 'initial' | 'steer' | 'follow-up'

export type AgentEvent =
  | { type: 'user_message'; inputId: string; delivery: InputDelivery; text: string }
  | { type: 'turn_started'; turnId: string; ordinal: number; inputIds: string[] }
  | { type: 'turn_ended'; turnId: string; reason: TurnEndReason }
  | { type: 'step_started'; stepId: string; turnId: string; ordinal: number; piTurnIndex: number }
  | { type: 'step_ended'; stepId: string; turnId: string; result: StepResult }
  | { type: 'system_prompt'; text: string }
  | { type: 'agent_started' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_started'; call: ToolCall }
  | { type: 'tool_updated'; toolCallId: string; partialResult: unknown }
  | { type: 'tool_finished'; result: ToolResult }
  | { type: 'plan_updated'; plan: AgentPlan }
  | { type: 'artifact_created'; artifact: Artifact }
  | {
      type: 'context_compaction_started'
      reason: 'manual' | 'threshold' | 'overflow'
    }
  | {
      type: 'context_compaction_completed'
      reason: 'manual' | 'threshold' | 'overflow'
      tokensBefore?: number
      estimatedTokensAfter?: number
    }
  | {
      type: 'context_compaction_failed'
      reason: 'manual' | 'threshold' | 'overflow'
      error: string
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
