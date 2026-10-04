import type { AgentEventEnvelope } from './agentExecutionRecord'
import type { AgentRun } from './agentRun'
import type { AgentActivity } from './agentActivity'
import { mapToolCallToActivity } from './agentActivityMapper'

export function deriveAgentActivities(
  events: readonly AgentEventEnvelope[],
  run?: Pick<AgentRun, 'status' | 'completedAt' | 'updatedAt'>,
): AgentActivity[] {
  const activities: AgentActivity[] = []
  const tools = new Map<string, number>()
  const approvals = new Map<string, number>()
  let thinking: Extract<AgentActivity, { type: 'thinking' }> | undefined
  let pendingInference = false

  const endThinking = (timestamp: number, failed = false) => {
    if (!thinking) return
    thinking.status = failed ? 'failed' : 'completed'
    thinking.endedAt = timestamp
    thinking = undefined
  }
  const startThinking = (record: AgentEventEnvelope) => {
    endThinking(record.timestamp)
    thinking = {
      id: `${record.runId}:thinking:${record.seq}`,
      type: 'thinking',
      content: '',
      status: 'running',
      startedAt: record.timestamp,
    }
    activities.push(thinking)
  }
  for (const record of [...events].sort((a, b) => a.seq - b.seq)) {
    const { event, timestamp } = record
    switch (event.type) {
      case 'inference_started':
        if (!pendingInference || !thinking) startThinking(record)
        pendingInference = false
        break
      case 'step_started':
        startThinking(record)
        pendingInference = true
        break
      case 'thinking_delta':
        if (!thinking) startThinking(record)
        thinking!.content += event.text
        break
      case 'inference_finished':
        endThinking(timestamp, event.failed)
        break
      case 'text_delta':
        if (event.text) endThinking(timestamp)
        break
      case 'tool_started':
        endThinking(timestamp)
        tools.set(event.call.id, activities.length)
        activities.push(mapToolCallToActivity(event.call, 'running', { startedAt: timestamp }))
        break
      case 'tool_updated': {
        const index = tools.get(event.toolCallId)
        const activity = index === undefined ? undefined : activities[index]
        if (activity && 'call' in activity) {
          activity.result = event.partialResult as typeof activity.result
        }
        break
      }
      case 'tool_finished': {
        const index = tools.get(event.result.toolCallId)
        const activity = index === undefined ? undefined : activities[index]
        if (activity && 'call' in activity) {
          activities[index!] = mapToolCallToActivity(
            activity.call,
            event.result.status === 'error' ? 'failed' : 'completed',
            { startedAt: activity.startedAt, endedAt: timestamp },
            event.result,
          )
        }
        break
      }
      case 'approval_required':
        endThinking(timestamp)
        approvals.set(event.approvalId, activities.length)
        activities.push({
          id: event.approvalId,
          type: 'approval',
          call: event.call,
          label: event.call.toolName,
          status: 'waiting',
          startedAt: timestamp,
        })
        break
      case 'approval_resolved': {
        const index = approvals.get(event.approvalId)
        const activity = index === undefined ? undefined : activities[index]
        if (activity) {
          activity.status = event.decision === 'allow' ? 'completed' : 'failed'
          activity.endedAt = timestamp
        }
        break
      }
      case 'step_ended':
        endThinking(timestamp, event.result === 'aborted')
        break
      case 'agent_completed':
      case 'agent_failed':
      case 'agent_aborted':
        endThinking(timestamp, event.type !== 'agent_completed')
        for (const activity of activities) {
          if (activity.status === 'running' || activity.status === 'waiting') {
            activity.status = 'failed'
            activity.endedAt = timestamp
          }
        }
        break
    }
  }
  if (run && !['created', 'running', 'waiting'].includes(run.status)) {
    for (const activity of activities) {
      if (activity.status === 'running' || activity.status === 'waiting') {
        activity.status =
          run.status === 'completed' && activity.type === 'thinking' ? 'completed' : 'failed'
        activity.endedAt = run.completedAt ?? run.updatedAt
      }
    }
  }
  return activities.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}
