import type { AgentEvent } from '../../shared/agent/agentEvent'

import type { AgentRun } from '../../shared/agent/agentRun'

export function getAgentRunPatch(run: AgentRun, event: AgentEvent): Partial<AgentRun> | undefined {
  switch (event.type) {
    case 'agent_started':
      return { status: 'running', startedAt: run.startedAt ?? Date.now() }

    case 'text_delta':
    case 'tool_started':
    case 'tool_updated':
    case 'tool_finished':
      return { status: 'running' }

    case 'approval_required':
      return { status: 'waiting' }

    case 'agent_completed':
      return { status: 'completed', completedAt: Date.now() }

    case 'agent_failed':
      return { status: 'failed', completedAt: Date.now(), error: event.error }

    case 'agent_aborted':
      return { status: 'aborted', completedAt: Date.now() }

    default:
      return undefined
  }
}
