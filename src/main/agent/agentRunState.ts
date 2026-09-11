import type { AgentEvent } from '../../shared/agent/agentEvent'

import type { AgentRun } from '../../shared/agent/agentRun'

const terminalStatuses = new Set<AgentRun['status']>([
  'completed',
  'failed',
  'aborted',
  'interrupted',
])

export function getAgentRunPatch(
  run: AgentRun,
  event: AgentEvent,
  timestamp = Date.now(),
): Partial<AgentRun> | undefined {
  if (terminalStatuses.has(run.status)) {
    return undefined
  }

  switch (event.type) {
    case 'user_message':
    case 'system_prompt':
      return undefined

    case 'agent_started':
      if (run.status === 'running') return undefined
      return { status: 'running', startedAt: run.startedAt ?? timestamp }

    case 'text_delta':
    case 'tool_updated':
      if (run.status === 'running') return undefined
      return { status: 'running' }

    case 'tool_started':
      return {
        status: 'running',
        toolCalls: run.toolCalls.some(({ id }) => id === event.call.id)
          ? run.toolCalls
          : [...run.toolCalls, event.call],
      }

    case 'tool_finished':
      return {
        status: 'running',
        toolResults: [
          ...run.toolResults.filter(({ toolCallId }) => toolCallId !== event.result.toolCallId),
          event.result,
        ],
      }

    case 'artifact_created':
      return {
        status: 'running',
        artifactIds: run.artifactIds.includes(event.artifact.id)
          ? run.artifactIds
          : [...run.artifactIds, event.artifact.id],
      }

    case 'approval_required':
      if (run.status === 'waiting') return undefined
      return { status: 'waiting' }

    case 'approval_resolved':
      if (run.status === 'running') return undefined
      return { status: 'running' }

    case 'agent_completed':
      return { status: 'completed', completedAt: timestamp }

    case 'agent_failed':
      return { status: 'failed', completedAt: timestamp, error: event.error }

    case 'agent_aborted':
      return { status: 'aborted', completedAt: timestamp }

    default:
      return undefined
  }
}
