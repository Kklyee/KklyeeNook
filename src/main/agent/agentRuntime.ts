import { AgentEvent } from '@/shared/agent/agentEvent'

export interface AgentRuntime {
  run(prompt: string, emit: (event: AgentEvent) => void, signal?: AbortSignal): Promise<void>
  dispose(): void
}

export interface AgentRuntimeFactory {
  create(sessionId: string): AgentRuntime
}
