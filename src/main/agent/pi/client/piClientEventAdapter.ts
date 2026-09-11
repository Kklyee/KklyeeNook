import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type {
  PiAgentMessage,
  PiAssistantMessageDelta,
  PiClientEventBody,
  PiSessionEntry,
} from '@assistant-ui/react-pi/node'

export function toPiClientEventBody(
  event: AgentSessionEvent,
  turnIndex: number,
): PiClientEventBody {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start' }
    case 'agent_end':
      return { type: 'agent_end', willRetry: event.willRetry }
    case 'agent_settled':
      return { type: 'agent_settled' }
    case 'turn_start':
      return { type: 'turn_start', turnIndex }
    case 'turn_end':
      return { type: 'turn_end', turnIndex }
    case 'message_start':
      return { type: 'message_start', message: event.message as unknown as PiAgentMessage }
    case 'message_update':
      return {
        type: 'message_update',
        message: event.message as unknown as PiAgentMessage,
        assistantMessageEvent: event.assistantMessageEvent as unknown as PiAssistantMessageDelta,
      }
    case 'message_end':
      return { type: 'message_end', message: event.message as unknown as PiAgentMessage }
    case 'tool_execution_start':
      return {
        type: 'tool_execution_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      }
    case 'tool_execution_update':
      return {
        type: 'tool_execution_update',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: event.partialResult,
      }
    case 'tool_execution_end':
      return {
        type: 'tool_execution_end',
        toolCallId: event.toolCallId,
        result: event.result,
        isError: event.isError,
      }
    case 'queue_update':
      return { type: 'queue_update', steering: event.steering, followUp: event.followUp }
    case 'compaction_start':
      return { type: 'compaction_start', reason: event.reason }
    case 'compaction_end':
      return { type: 'compaction_end', aborted: event.aborted, willRetry: event.willRetry }
    case 'entry_appended':
      return { type: 'entry_appended', entry: event.entry as unknown as PiSessionEntry }
    case 'auto_retry_start':
      return { type: 'auto_retry_start', attempt: event.attempt, delayMs: event.delayMs }
    case 'auto_retry_end':
      return { type: 'auto_retry_end', success: event.success }
    case 'session_info_changed':
      return event.name === undefined
        ? { type: 'session_info_changed' }
        : { type: 'session_info_changed', name: event.name }
    case 'thinking_level_changed':
      return { type: 'thinking_level_changed', level: event.level }
    default:
      return { type: event.type } as unknown as PiClientEventBody
  }
}
