import type { AgentRuntime } from './agentRuntime'

export interface AgentRuntimeFactory {
  create(sessionId: string): AgentRuntime
}
