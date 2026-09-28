import type { AgentRuntimeFactory } from '../../agentRuntime'
import { PiAgentRuntime } from './piAgentRuntime'
import type { PiSessionRuntimeManager } from './piSessionRuntimeManager'

export function createPiAgentRuntimeFactory(
  sessionRuntimeManager: PiSessionRuntimeManager,
): AgentRuntimeFactory {
  return {
    create(sessionId, options) {
      const runtimeSessionId = options?.runtimeSessionId ?? sessionId
      return new PiAgentRuntime(
        sessionRuntimeManager.getOrCreate(runtimeSessionId, {
          persistState: options?.persistState,
          permissionSessionId: options?.permissionSessionId ?? sessionId,
        }),
        () => {
          sessionRuntimeManager.delete(runtimeSessionId)
        },
      )
    },
  }
}
