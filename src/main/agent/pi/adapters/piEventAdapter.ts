import { type AgentSessionEvent as PIAgentEvent } from '@earendil-works/pi-coding-agent'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import { normalizeToolResult, toolError } from '@/shared/tool/toolExecutionResult'
import type { ToolExecutionResult } from '@/shared/tool/tool'

export function normalizePiToolExecutionEnd(event: Extract<PIAgentEvent, { type: 'tool_execution_end' }>): void {
  let result = normalizeToolResult(event.result, event.isError)
  if (event.isError && event.result.content?.some(block => block.type === 'text' && block.text === `Tool ${event.toolName} not found`))
    result = toolError('UNKNOWN_TOOL', `Unknown tool: ${event.toolName}`)
  if (event.isError && event.result.content?.some(block => block.type === 'text' && block.text === 'Operation aborted'))
    result = toolError('ABORTED', 'Tool execution aborted')
  const { content, ...details } = result
  Object.assign(event.result, { content, details })
  event.isError = result.status === 'error'
}

export function convertPiEvent(event: PIAgentEvent): AgentEvent | undefined {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_started' }

    case 'message_start':
      return event.message.role === 'assistant' ? { type: 'inference_started' } : undefined

    case 'message_end':
      return event.message.role === 'assistant'
        ? { type: 'inference_finished', failed: ['error', 'aborted'].includes(event.message.stopReason) }
        : undefined

    case 'message_update': {
      const update = event.assistantMessageEvent

      if (update.type === 'text_delta') {
        return { type: 'text_delta', text: update.delta }
      }

      if (update.type === 'thinking_delta') {
        return { type: 'thinking_delta', text: update.delta }
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
        return { type: 'agent_failed', error: finalAssistantMessage.errorMessage ?? '模型请求失败' }
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

    case 'tool_execution_end': {
      normalizePiToolExecutionEnd(event)
      return {
        type: 'tool_finished',
        result: {
          ...event.result.details as ToolExecutionResult,
          content: event.result.content,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        },
      }
    }

    default:
      return undefined
  }
}
