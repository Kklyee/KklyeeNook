import { AgentEvent } from '@/shared/agent/agentEvent'
import type { PiSendMessageInput } from '@assistant-ui/react-pi/node'
import type { AgentRunContext } from '../context/contextBuilder'

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
    emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>
  dispose(): void
}

export interface AgentRuntimeFactory {
  create(sessionId: string, options?: AgentRuntimeFactoryOptions): AgentRuntime
}
