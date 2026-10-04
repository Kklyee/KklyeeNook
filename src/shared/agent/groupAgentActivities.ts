import type { AgentActivity } from './agentActivity'
import type { AgentEventEnvelope } from './agentExecutionRecord'

export interface ActivitySegment {
  textOffset: number
  activities: readonly AgentActivity[]
  endedAt?: number
}

export function groupAgentActivities(
  events: readonly AgentEventEnvelope[],
  activities: readonly AgentActivity[],
): ActivitySegment[] {
  const offsets = new Map<string, number>()
  const endings = new Map<number, number>()
  let textOffset = 0
  for (const record of [...events].sort((a, b) => a.seq - b.seq)) {
    const { event } = record
    switch (event.type) {
      case 'step_started':
      case 'inference_started':
      case 'thinking_delta':
        offsets.set(`${record.runId}:thinking:${record.seq}`, textOffset)
        break
      case 'tool_started':
        offsets.set(event.call.id, textOffset)
        break
      case 'approval_required':
        offsets.set(event.approvalId, textOffset)
        break
      case 'text_delta':
        if (event.text) {
          endings.set(textOffset, record.timestamp)
          textOffset += event.text.length
        }
        break
    }
  }
  const segments = new Map<number, AgentActivity[]>()
  for (const activity of activities) {
    const offset = offsets.get(activity.id) ?? 0
    const entries = segments.get(offset)
    if (entries) entries.push(activity)
    else segments.set(offset, [activity])
  }
  return [...segments].map(([offset, entries]) => ({
    textOffset: offset,
    activities: entries,
    endedAt: endings.get(offset),
  }))
}
