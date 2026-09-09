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
        toolCallId: event.toolCallId,
        tool: event.toolName,
        args: event.args,
      }

    case 'tool_execution_update':
      return {
        type: 'tool_updated',
        toolCallId: event.toolCallId,
        tool: event.toolName,
        partialResult: event.partialResult,
      }

    case 'tool_execution_end':
      return {
        type: 'tool_finished',
        toolCallId: event.toolCallId,
        tool: event.toolName,
        result: event.result,
        success: !event.isError,
      }

    default:
      return undefined
  }
}
