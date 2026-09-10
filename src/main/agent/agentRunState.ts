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
    case 'agent_started':
      if (run.status === 'running') return undefined
      return { status: 'running', startedAt: run.startedAt ?? timestamp }

    case 'text_delta':
    case 'tool_started':
    case 'tool_updated':
    case 'tool_finished':
      if (run.status === 'running') return undefined
      return { status: 'running' }

    case 'approval_required':
      if (run.status === 'waiting') return undefined
      return { status: 'waiting' }

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
