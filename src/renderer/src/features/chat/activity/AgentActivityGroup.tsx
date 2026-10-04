import { memo, useMemo, useState } from 'react'
import { useAui, useAuiState, type ThreadMessage } from '@assistant-ui/react'
import type { PiRuntimeExtras } from '@assistant-ui/react-pi'
import { CheckIcon } from 'lucide-react'
import { ToolTimeline } from '@/renderer/src/components/assistant-ui/elements/tool-timeline'
import { ToolIcon } from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { currentActivity } from '@/shared/agent/agentActivityTiming'
import { formatActivityLabel } from '@/shared/agent/agentActivityFormatter'
import { summarizeAgentActivities } from '@/shared/agent/agentActivitySummary'
import { ShimmerLabel } from '@/renderer/src/lib/surfaces'
import {
  ActivityCrossfade,
  ActivityDuration,
  ActivityIcon,
  AgentActivityRow,
} from './AgentActivity'
import { useActivitySelector, type ActivityRun } from './AgentActivityProvider'

export function AgentActivityGroup() {
  const id = useAuiState((state) => state.message.id)
  const isLast = useAuiState((state) => state.message.isLast)
  const status = useAuiState((state) => state.message.status?.type)
  const messageCount = useAuiState((state) => state.thread.messages.length)
  const aui = useAui()
  const running = isLast && (status === 'running' || status === 'requires-action')
  const runId = useActivitySelector((groups) => {
    const thread = aui.thread.getState()
    const transcript = (thread.extras as PiRuntimeExtras | undefined)?.state?.messages
    const match = (message: ThreadMessage): ActivityRun | undefined => {
      const messageRunId = message.metadata.custom?.runId
      if (typeof messageRunId === 'string')
        return groups.find((group) => group.run.id === messageRunId)
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
        (message.id === id && running
          ? groups.find(
              (group) =>
                !group.run.parentRunId &&
                ['created', 'running', 'waiting'].includes(group.run.status),
            )
          : undefined)
      )
    }
    const group = match(aui.message.getState())
    if (!group) return undefined
    const owner = thread.messages
      .slice(0, messageCount)
      .find((message) => message.role === 'assistant' && match(message)?.run.id === group.run.id)
    return owner && owner.id !== id ? null : group.run.id
  })
  const startedAt = useAuiState((state) => state.message.createdAt.getTime())
  if (runId === null || (!runId && !running)) return null
  return <ActivityTimeline runId={runId} startedAt={startedAt} />
}

const ActivityTimeline = memo(function ActivityTimeline({
  runId,
  startedAt,
}: {
  runId?: string
  startedAt: number
}) {
  const [open, setOpen] = useState(false)
  const activityIds = useActivitySelector(
    (groups) =>
      groups
        .find((group) => group.run.id === runId)
        ?.activities.map((activity) => activity.id)
        .join('\n') ?? '',
  )
  const ids = useMemo(() => (activityIds ? activityIds.split('\n') : []), [activityIds])
  const running = useActivitySelector((groups) => {
    const run = groups.find((group) => group.run.id === runId)?.run
    return !run || ['created', 'running', 'waiting'].includes(run.status)
  })
  return (
    <div data-slot="agent-activity-slot" data-running={running} className="agent-activity-slot">
      <ToolTimeline
        open={open}
        onOpenChange={setOpen}
        label={<ActivityHeader runId={runId} />}
        trailing={<ActivityHeaderDuration runId={runId} startedAt={startedAt} />}
      >
        {ids.map((id) => (
          <AgentActivityRow key={id} runId={runId!} activityId={id} />
        ))}
      </ToolTimeline>
    </div>
  )
})

function ActivityHeader({ runId }: { runId?: string }) {
  const run = useActivitySelector((groups) => groups.find((group) => group.run.id === runId)?.run)
  const current = useActivitySelector((groups) =>
    currentActivity(groups.find((group) => group.run.id === runId)?.activities ?? []),
  )
  const summary = useActivitySelector((groups) =>
    summarizeAgentActivities(groups.find((group) => group.run.id === runId)?.activities ?? []),
  )
  const completed = run?.status === 'completed'
  const running = !run || ['created', 'running', 'waiting'].includes(run.status)
  const label = completed ? summary : current ? formatActivityLabel(current) : '思考中…'
  const transitionKey = completed
    ? 'completed'
    : current
      ? `${current.id}:${current.status}`
      : 'thinking'
  return (
    <ActivityCrossfade transitionKey={transitionKey}>
      {completed ? (
        <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : current ? (
        <ActivityIcon activity={current} />
      ) : (
        <ToolIcon kind="thinking" />
      )}
      <ShimmerLabel
        active={running}
        data-slot="agent-activity-summary"
        className="shimmer-speed-100 shimmer-repeat-delay-0 min-w-0 truncate"
        title={label}
      >
        {label}
      </ShimmerLabel>
    </ActivityCrossfade>
  )
}

function ActivityHeaderDuration({ runId, startedAt }: { runId?: string; startedAt: number }) {
  const run = useActivitySelector((groups) => groups.find((group) => group.run.id === runId)?.run)
  const current = useActivitySelector((groups) =>
    currentActivity(groups.find((group) => group.run.id === runId)?.activities ?? []),
  )
  const completed = run && !['created', 'running', 'waiting'].includes(run.status)
  return (
    <ActivityDuration
      startedAt={completed ? (run.startedAt ?? run.createdAt) : (current?.startedAt ?? startedAt)}
      endedAt={completed ? run.completedAt : current?.endedAt}
    />
  )
}
