import { type AgentSessionEvent as PIAgentEvent } from '@earendil-works/pi-coding-agent'
import type { AgentEvent } from '@/shared/agent/agentEvent'

export function convertPIEvent(event: PIAgentEvent): AgentEvent | undefined {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_started' }

    case 'message_update': {
      const update = event.assistantMessageEvent

      if (update.type === 'text_delta') {
        return { type: 'text_delta', text: update.delta }
      }

      return undefined
    }

    case 'tool_execution_start':
      return { type: 'tool_started', tool: event.toolName }

    case 'tool_execution_end':
      return { type: 'tool_finished', tool: event.toolName, success: !event.isError }

    default:
      return undefined
  }
}
