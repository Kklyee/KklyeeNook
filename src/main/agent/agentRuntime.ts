import { AgentEvent } from '@/shared/agent/agentEvent'
import type { PiSendMessageInput } from '@assistant-ui/react-pi/node'
import type { AgentRunContext } from '../context/contextBuilder'
import type { InputDelivery } from '@/shared/agent/agentEvent'
import type { StepResult } from '@/shared/agent/agentStep'

export type ExecutionBoundaryEvent =
  | { type: 'pi_turn_start'; piTurnIndex: number; deliveries: InputDelivery[] }
  | { type: 'pi_turn_end'; result: StepResult }
  | { type: 'pi_agent_settled' }

export type AgentRuntimeEvent = AgentEvent | ExecutionBoundaryEvent

export interface AgentRuntimeFactoryOptions {
  runtimeSessionId?: string
  permissionSessionId?: string
  persistState?: boolean
  parentRuntimeSessionId?: string
}

export interface AgentRuntimeInput {
  prompt: string
  runId?: string
  context?: AgentRunContext
  attachments?: PiSendMessageInput['attachments']
  skillIds?: string[]
  scheduledTaskId?: string
}

export interface AgentRuntime {
  run(
    input: AgentRuntimeInput,
    emit: (event: AgentRuntimeEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>
  dispose(): void
}

export interface AgentRuntimeFactory {
  create(sessionId: string, options?: AgentRuntimeFactoryOptions): AgentRuntime
}
