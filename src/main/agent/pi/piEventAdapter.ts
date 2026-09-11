import { type AgentSessionEvent as PIAgentEvent } from '@earendil-works/pi-coding-agent'
import type { AgentEvent } from '@/shared/agent/agentEvent'

export function convertPiEvent(event: PIAgentEvent): AgentEvent | undefined {
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

    case 'agent_end': {
      if (event.willRetry) {
        return undefined
      }

      const finalAssistantMessage = [...event.messages]
        .reverse()
        .find((message) => message.role === 'assistant')

      if (!finalAssistantMessage) {
        return undefined
      }

      if (finalAssistantMessage.stopReason === 'aborted') {
        return { type: 'agent_aborted' }
      }

      if (finalAssistantMessage.stopReason === 'error') {
        return {
          type: 'agent_failed',
          error: finalAssistantMessage.errorMessage ?? '模型请求失败',
        }
      }

      return undefined
    }

    case 'tool_execution_start':
      return {
        type: 'tool_started',
        call: { id: event.toolCallId, toolName: event.toolName, args: event.args },
      }

    case 'tool_execution_update':
      return {
        type: 'tool_updated',
        toolCallId: event.toolCallId,
        partialResult: event.partialResult,
      }

    case 'tool_execution_end':
      return {
        type: 'tool_finished',
        result: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: event.result,
          success: event.isError !== true,
        },
      }

    default:
      return undefined
  }
}
