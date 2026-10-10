import { memo, useMemo, useState } from 'react'
import { useAui, useAuiState, type ThreadMessage } from '@assistant-ui/react'
import type { ChatExtras } from '../runtime/chat-store'
import { CheckIcon } from 'lucide-react'
import type { AgentActivity } from '@/shared/agent/agentActivity'
import { ToolTimeline } from '@/renderer/src/components/assistant-ui/elements/tool-timeline'
import { currentActivity } from '@/shared/agent/agentActivityTiming'
import { formatActivityLabel } from '@/shared/agent/agentActivityFormatter'
import { summarizeAgentActivities } from '@/shared/agent/agentActivitySummary'
import { ShimmerLabel } from '@/renderer/src/lib/surfaces'
import {
  ActivityCrossfade,
  ActivityDuration,
  AgentActivityRow,
} from './AgentActivity'
import { ActivityIcon } from '@/renderer/src/components/assistant-ui/elements/tool-icon'
import { useActivitySelector, type ActivityRun } from './AgentActivityProvider'

interface ActivityScope {
  runId?: string
  textOffset: number
  startedAt: number
  fallback: boolean
}

const hasContent = (activity: AgentActivity) =>
  activity.type !== 'thinking' || !!activity.content.trim()

const findSegment = (groups: readonly ActivityRun[], scope: ActivityScope) =>
  groups
    .find((group) => group.run.id === scope.runId)
    ?.segments.find((segment) => segment.textOffset === scope.textOffset)

function isRunning(groups: readonly ActivityRun[], scope: ActivityScope) {
  const group = groups.find((entry) => entry.run.id === scope.runId)
  const segment = findSegment(groups, scope)
  if (!group || !segment) return scope.fallback
  return (
    ['created', 'running', 'waiting'].includes(group.run.status) &&
    (segment.endedAt === undefined ||
      segment.activities.some(
        (activity) => activity.status === 'running' || activity.status === 'waiting',
      ))
  )
}

export function AgentActivityGroup({ afterPartIndex }: { afterPartIndex?: number }) {
  const id = useAuiState((state) => state.message.id)
  const isLast = useAuiState((state) => state.message.isLast)
  const status = useAuiState((state) => state.message.status?.type)
  const messageCount = useAuiState((state) => state.thread.messages.length)
  const textOffset = useAuiState((state) =>
    afterPartIndex === undefined
      ? 0
      : state.message.content
          .slice(0, afterPartIndex + 1)
          .reduce((offset, part) => offset + (part.type === 'text' ? part.text.length : 0), 0),
  )
  const aui = useAui()
  const running = isLast && (status === 'running' || status === 'requires-action')
  const answered = useAuiState((state) =>
    state.message.content.some((part) => part.type === 'text' && part.text.trim() !== ''),
  )
  const boundary = useActivitySelector((groups) => {
    const thread = aui.thread.getState()
    const transcript = (thread.extras as ChatExtras | undefined)?.state?.messages
    const match = (message: ThreadMessage): ActivityRun | undefined => {
      const messageRunId = message.metadata.custom?.runId
      if (typeof messageRunId === 'string') {
        const group = groups.find((group) => group.run.id === messageRunId)
        if (group) return group
      }
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
    const message = aui.message.getState()
    const group = match(message)
    if (!group) return undefined
    const index = thread.messages.slice(0, messageCount).findIndex((entry) => entry.id === id)
    const previousText = thread.messages
      .slice(0, index)
      .reduce(
        (offset, entry) =>
          entry.role === 'assistant' && match(entry)?.run.id === group.run.id
            ? offset +
              entry.content.reduce(
                (total, part) => total + (part.type === 'text' ? part.text.length : 0),
                0,
              )
            : offset,
        0,
      )
    if (
      afterPartIndex !== undefined &&
      !message.content.slice(afterPartIndex + 1).some((part) => part.type === 'text') &&
      thread.messages
        .slice(index + 1)
        .some((entry) => entry.role === 'assistant' && match(entry)?.run.id === group.run.id)
    )
      return null
    return `${group.run.id}\n${previousText + textOffset}`
  })
  const startedAt = useAuiState((state) => state.message.createdAt.getTime())
  const scope = useMemo<ActivityScope>(() => {
    const [runId, offset] = boundary?.split('\n') ?? []
    return {
      runId,
      textOffset: Number(offset ?? textOffset),
      startedAt,
      fallback: running && afterPartIndex === undefined && !answered,
    }
  }, [boundary, textOffset, startedAt, running, afterPartIndex, answered])
  if (boundary === null || (!boundary && !scope.fallback)) return null
  return <ActivityTimeline scope={scope} />
}

const ActivityTimeline = memo(function ActivityTimeline({ scope }: { scope: ActivityScope }) {
  const [open, setOpen] = useState(false)
  const activityIds = useActivitySelector(
    (groups) =>
      findSegment(groups, scope)
        ?.activities.filter(hasContent)
        .map((activity) => activity.id)
        .join('\n') ?? '',
  )
  const ids = useMemo(() => (activityIds ? activityIds.split('\n') : []), [activityIds])
  const running = useActivitySelector((groups) => isRunning(groups, scope))
  const exists = useActivitySelector((groups) => !!findSegment(groups, scope))
  const current = useActivitySelector((groups) =>
    currentActivity(findSegment(groups, scope)?.activities ?? []),
  )
  if ((!exists && !scope.fallback) || (exists && !ids.length && !running)) return null
  return (
    <div
      data-slot="agent-activity-slot"
      data-text-offset={scope.textOffset}
      data-running={running}
      className="agent-activity-slot"
    >
      <ToolTimeline
        open={open}
        onOpenChange={setOpen}
        label={<ActivityHeader scope={scope} current={current} />}
        trailing={current ? <ActivityHeaderDuration scope={scope} /> : null}
      >
        {ids.map((id) => (
          <AgentActivityRow key={id} runId={scope.runId!} activityId={id} />
        ))}
      </ToolTimeline>
    </div>
  )
})

function ActivityHeader({
  scope,
  current,
}: {
  scope: ActivityScope
  current?: AgentActivity
}) {
  const summary = useActivitySelector((groups) =>
    summarizeAgentActivities(findSegment(groups, scope)?.activities.filter(hasContent) ?? []),
  )
  const running = useActivitySelector((groups) => isRunning(groups, scope))
  const completed = !running && current?.status !== 'failed'
  const label = !current ? undefined : completed ? summary : formatActivityLabel(current)
  const transitionKey = !current
    ? 'waiting'
    : completed
      ? 'completed'
      : `${current.id}:${current.status}`
  return (
    <ActivityCrossfade transitionKey={transitionKey}>
      {!current ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 animate-pulse rounded-full bg-current motion-reduce:animate-none"
        />
      ) : completed ? (
        <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <ActivityIcon type={current.type} status={current.status} />
      )}
      {label !== undefined && (
        <ShimmerLabel
          active={running}
          data-slot="agent-activity-summary"
          className="shimmer-speed-100 shimmer-repeat-delay-0 min-w-0 truncate"
          title={label}
        >
          {label}
        </ShimmerLabel>
      )}
    </ActivityCrossfade>
  )
}

function ActivityHeaderDuration({ scope }: { scope: ActivityScope }) {
  const startedAt = useActivitySelector((groups) => {
    const segment = findSegment(groups, scope)
    return isRunning(groups, scope)
      ? (currentActivity(segment?.activities ?? [])?.startedAt ?? scope.startedAt)
      : (segment?.activities[0]?.startedAt ?? scope.startedAt)
  })
  const endedAt = useActivitySelector((groups) => {
    if (isRunning(groups, scope)) return undefined
    const group = groups.find((entry) => entry.run.id === scope.runId)
    const segment = findSegment(groups, scope)
    return segment
      ? Math.max(
          segment.endedAt ?? 0,
          ...segment.activities.map((activity) => activity.endedAt ?? activity.startedAt ?? 0),
        )
      : group?.run.completedAt
  })
  return <ActivityDuration startedAt={startedAt} endedAt={endedAt} />
}
