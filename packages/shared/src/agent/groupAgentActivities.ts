import type { AgentActivity } from '@kklyeenook/shared/agent/agentActivity'
import type { AgentEventEnvelope } from '@kklyeenook/shared/agent/agentExecutionRecord'

export interface ActivitySegment {
  inputId?: string
  textOffset: number
  activities: readonly AgentActivity[]
  endedAt?: number
}

export function groupAgentActivities(
  events: readonly AgentEventEnvelope[],
  activities: readonly AgentActivity[],
): ActivitySegment[] {
  const offsets = new Map<string, { inputId?: string; textOffset: number }>()
  const endings = new Map<string, number>()
  let textOffset = 0
  let inputId: string | undefined
  const key = () => JSON.stringify([inputId, textOffset])
  for (const record of [...events].sort((a, b) => a.seq - b.seq)) {
    const { event } = record
    switch (event.type) {
      case 'user_message':
        endings.set(key(), record.timestamp)
        inputId = event.inputId
        textOffset = 0
        break
      case 'step_started':
      case 'inference_started':
      case 'thinking_delta':
        offsets.set(`${record.runId}:thinking:${record.seq}`, { inputId, textOffset })
        break
      case 'tool_started':
        offsets.set(event.call.id, { inputId, textOffset })
        break
      case 'approval_required':
        offsets.set(event.approvalId, { inputId, textOffset })
        break
      case 'text_delta':
        if (event.text) {
          endings.set(key(), record.timestamp)
          textOffset += event.text.length
        }
        break
    }
  }
  const segments = new Map<string, ActivitySegment & { activities: AgentActivity[] }>()
  for (const activity of activities) {
    const offset = offsets.get(activity.id) ?? { textOffset: 0 }
    const segmentKey = JSON.stringify([offset.inputId, offset.textOffset])
    const entries = segments.get(segmentKey)
    if (entries) entries.activities.push(activity)
    else segments.set(segmentKey, { ...offset, activities: [activity] })
  }
  return [...segments].map(([offset, entries]) => ({
    ...entries,
    endedAt: endings.get(offset),
  }))
}
