import { AgentEvent } from '@/shared/agent/agentEvent'
import type { PiSendMessageInput } from '@assistant-ui/react-pi/node'
import type { AgentRunContext } from '../context/contextBuilder'

export interface AgentRuntimeInput {
  prompt: string
  context?: AgentRunContext
  attachments?: PiSendMessageInput['attachments']
}

export interface AgentRuntime {
  run(
    input: AgentRuntimeInput,
    emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>
  dispose(): void
}

export interface AgentRuntimeFactory {
  create(sessionId: string): AgentRuntime
}
