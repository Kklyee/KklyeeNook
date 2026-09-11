import type { AgentRuntimeFactory } from '../../agentRuntime'
import { PiAgentRuntime } from './piAgentRuntime'
import type { PiSessionHostManager } from './piSessionHostManager'

export function createPiAgentRuntimeFactory(
  hostManager: PiSessionHostManager,
): AgentRuntimeFactory {
  return {
    create(sessionId) {
      return new PiAgentRuntime(hostManager.getOrCreate(sessionId), () => {
        hostManager.delete(sessionId)
      })
    },
  }
}
