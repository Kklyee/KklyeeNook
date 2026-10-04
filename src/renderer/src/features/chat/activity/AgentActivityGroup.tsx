import { memo, useEffect, useState } from 'react'
import { useAui, useAuiState, type ThreadMessage } from '@assistant-ui/react'
import type { PiRuntimeExtras } from '@assistant-ui/react-pi'
import { ToolTimeline } from '@/renderer/src/components/assistant-ui/elements/tool-timeline'
import { currentActivity, formatDuration, groupDuration } from '@/shared/agent/agentActivityTiming'
import { formatActivityLabel } from '@/shared/agent/agentActivityFormatter'
import { summarizeAgentActivities } from '@/shared/agent/agentActivitySummary'
import { ActivityDuration, ActivityIcon, AgentActivityRow } from './AgentActivity'
import { useActivityRuns, type ActivityRun } from './AgentActivityProvider'

export function AgentActivityGroup() {
  const id = useAuiState((state) => state.message.id)
  const isLast = useAuiState((state) => state.message.isLast)
  const aui = useAui()
  const groups = useActivityRuns()
  const thread = aui.thread.getState()
  const transcript = (thread.extras as PiRuntimeExtras | undefined)?.state?.messages
  const match = (message: ThreadMessage): ActivityRun | undefined => {
    const runId = message.metadata.custom?.runId
    if (typeof runId === 'string') return groups.find((group) => group.run.id === runId)
    const ids = new Set(
      message.content.flatMap((part) => (part.type === 'tool-call' ? [part.toolCallId] : [])),
    )
    const timestamp =
      transcript?.[Number(message.id.split(':')[1])]?.timestamp ?? message.createdAt.getTime()
    return (
      groups.find(
        (group) =>
          !group.run.parentRunId &&
          group.activities.some((activity) => 'call' in activity && ids.has(activity.call.id)),
      ) ??
      groups.find(
        (group) =>
          !group.run.parentRunId &&
          timestamp >= group.run.createdAt &&
          timestamp <= (group.run.completedAt ?? Infinity),
      ) ??
      (message.id === id &&
      isLast &&
      (message.status?.type === 'running' || message.status?.type === 'requires-action')
        ? groups.find(
            (group) =>
              !group.run.parentRunId &&
              ['created', 'running', 'waiting'].includes(group.run.status),
          )
        : undefined)
    )
  }
  const message = aui.message.getState()
  const group = match(message)
  if (!group || !group.activities.length) return null
  const owner = thread.messages.find(
    (candidate) => candidate.role === 'assistant' && match(candidate)?.run.id === group.run.id,
  )
  if (owner && owner.id !== id) return null
  return <ActivityTimeline group={group} />
}

const ActivityTimeline = memo(function ActivityTimeline({ group }: { group: ActivityRun }) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  const { activities, run } = group
  const current = currentActivity(activities)
  const active = activities.some(
    (activity) => activity.status === 'running' || activity.status === 'waiting',
  )
  const running = active || ['created', 'running', 'waiting'].includes(run.status)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [running])
  if (!current) return null
  const showCurrent = running || run.status !== 'completed'
  const summary = summarizeAgentActivities(activities)
  return (
    <ToolTimeline
      open={open}
      onOpenChange={setOpen}
      label={
        <>
          {showCurrent && <ActivityIcon activity={current} />}
          <span
            data-slot="agent-activity-summary"
            className="min-w-0 flex-1 truncate"
            title={showCurrent ? formatActivityLabel(current) : summary}
          >
            {showCurrent ? formatActivityLabel(current) : summary}
          </span>
          {showCurrent ? (
            <ActivityDuration activity={current} now={now} />
          ) : (
            <span className="shrink-0 text-[11px] tabular-nums text-faint-foreground">
              {formatDuration(groupDuration(activities, now))}
            </span>
          )}
        </>
      }
    >
      {activities.map((activity) => (
        <AgentActivityRow key={activity.id} activity={activity} now={activity.endedAt ?? now} />
      ))}
    </ToolTimeline>
  )
})
