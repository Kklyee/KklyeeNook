import type { AgentRuntimeFactory } from '../../agentRuntime'
import { PiAgentRuntime } from './piAgentRuntime'
import type { PiSessionRuntimeManager } from './piSessionRuntimeManager'

export function createPiAgentRuntimeFactory(
  sessionRuntimeManager: PiSessionRuntimeManager,
): AgentRuntimeFactory {
  return {
    create(sessionId) {
      return new PiAgentRuntime(sessionRuntimeManager.getOrCreate(sessionId), () => {
        sessionRuntimeManager.delete(sessionId)
      })
    },
  }
}
