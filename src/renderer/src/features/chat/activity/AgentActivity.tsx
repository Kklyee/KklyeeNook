import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, ChevronRightIcon, CircleAlertIcon, WrenchIcon } from 'lucide-react'
import {
  TextMessagePartProvider,
  useMessagePartText,
  useSmooth,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react'
import type { AgentActivity as Activity } from '@/shared/agent/agentActivity'
import { formatActivityLabel } from '@/shared/agent/agentActivityFormatter'
import { activityDuration, formatDuration } from '@/shared/agent/agentActivityTiming'
import { useActivitySelector } from './AgentActivityProvider'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/renderer/src/components/ui/collapsible'
import {
  ToolDetailProvider,
  ToolIcon,
} from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { ToolCallRenderer } from '../tools/ToolCallRenderer'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { cn } from '@/renderer/src/lib/utils'
import { collapsePanel, ShimmerLabel } from '@/renderer/src/lib/surfaces'
import { usePreview } from '../../preview/PreviewProvider'

export function ActivityIcon({ activity }: { activity: Activity }) {
  if (activity.status !== 'failed' && activity.type !== 'approval' && activity.type !== 'tool')
    return (
      <span
        className={cn(
          'flex shrink-0',
          activity.status === 'running' && 'animate-pulse motion-reduce:animate-none',
        )}
      >
        <ToolIcon kind={activity.type === 'shell' ? 'bash' : activity.type} />
      </span>
    )
  const Icon =
    activity.status === 'failed' || activity.type === 'approval' ? CircleAlertIcon : WrenchIcon
  return (
    <Icon
      aria-hidden="true"
      strokeWidth={1.5}
      className={cn(
        'size-3.5 shrink-0 text-muted-foreground',
        activity.status === 'running' && 'animate-pulse motion-reduce:animate-none',
      )}
    />
  )
}

export const ActivityDuration = memo(function ActivityDuration({
  startedAt,
  endedAt,
}: {
  startedAt?: number
  endedAt?: number
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startedAt === undefined || endedAt !== undefined) return
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [startedAt, endedAt])
  return (
    <span className="shrink-0 text-[11px] tabular-nums text-faint-foreground">
      {formatDuration(activityDuration({ startedAt, endedAt }, now))}
    </span>
  )
})

export function ActivityCrossfade({
  transitionKey,
  children,
}: {
  transitionKey: string
  children: ReactNode
}) {
  const last = useRef({ key: transitionKey, content: children })
  const [key, setKey] = useState(transitionKey)
  const [previous, setPrevious] = useState<typeof last.current | null>(null)
  if (key !== transitionKey) {
    setKey(transitionKey)
    setPrevious(last.current)
  }
  useLayoutEffect(() => {
    last.current = { key: transitionKey, content: children }
  })
  useEffect(() => {
    if (!previous) return
    const timer = setTimeout(() => setPrevious(null), 160)
    return () => clearTimeout(timer)
  }, [previous])
  return (
    <span className="activity-crossfade">
      {previous && (
        <span
          key={previous.key}
          aria-hidden="true"
          className="activity-crossfade-layer activity-crossfade-out"
        >
          {previous.content}
        </span>
      )}
      <span
        key={transitionKey}
        className={cn('activity-crossfade-layer', previous && 'activity-crossfade-in')}
      >
        {children}
      </span>
    </span>
  )
}

export const AgentActivityRow = memo(function AgentActivityRow({
  runId,
  activityId,
}: {
  runId: string
  activityId: string
}) {
  const activity = useActivitySelector((groups) =>
    groups
      .find((group) => group.run.id === runId)
      ?.activities.find((activity) => activity.id === activityId),
  )
  const [open, setOpen] = useState(false)
  const [entered, setEntered] = useState(false)
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  if (!activity) return null
  const label = formatActivityLabel(activity)
  return (
    <div className="activity-row-entrance" data-entered={entered}>
      <div className="activity-row-inner">
        <Collapsible
          open={open}
          onOpenChange={setOpen}
          data-slot="agent-activity"
          data-activity-type={activity.type}
          data-activity-status={activity.status}
          style={{ '--animation-duration': 'var(--motion-expand)' } as React.CSSProperties}
        >
          <CollapsibleTrigger className="group/trigger flex h-[32px] w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-[13px] text-foreground outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-border-strong">
            <ActivityCrossfade transitionKey={`${activity.type}:${activity.status}`}>
              <ActivityIcon activity={activity} />
            </ActivityCrossfade>
            <ShimmerLabel
              active={activity.status === 'running' || activity.status === 'waiting'}
              className="shimmer-speed-100 shimmer-repeat-delay-0 min-w-0 flex-1 truncate"
              title={label}
            >
              {label}
            </ShimmerLabel>
            {(activity.type === 'edit' || activity.type === 'write') &&
              activity.additions !== undefined && (
                <span className="shrink-0 text-[11px] tabular-nums text-faint-foreground">
                  +{activity.additions} −{activity.deletions ?? 0}
                </span>
              )}
            {(activity.type === 'search' || activity.type === 'glob') &&
              activity.resultCount !== undefined && (
                <span className="shrink-0 text-[11px] tabular-nums text-faint-foreground">
                  {activity.resultCount} {activity.type === 'glob' ? 'files' : 'matches'}
                </span>
              )}
            {activity.type !== 'thinking' && (
              <CheckIcon
                aria-hidden="true"
                strokeWidth={1.5}
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-opacity duration-(--motion-fast) motion-reduce:transition-none',
                  activity.status !== 'completed' && 'opacity-0',
                )}
              />
            )}
            <ActivityDuration startedAt={activity.startedAt} endedAt={activity.endedAt} />
            <ChevronRightIcon
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-3.5 shrink-0 text-faint-foreground transition-transform group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent
            keepMounted
            className={cn(collapsePanel, 'activity-panel outline-none')}
          >
            <div className="ml-5 min-w-0 border-l border-border px-3 py-2 text-xs text-muted-foreground">
              {activity.type === 'thinking' ? (
                <TextMessagePartProvider
                  text={activity.content}
                  isRunning={activity.status === 'running'}
                >
                  <ThinkingContent />
                </TextMessagePartProvider>
              ) : (
                <ActivityToolDetail activity={activity} />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
})

const thinkingPacing = { drainMs: 220, maxCharIntervalMs: 4, maxCharsPerFrame: 14, minCommitMs: 75 }

function ThinkingContent() {
  const { text } = useSmooth(useMessagePartText(), thinkingPacing)
  return <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{text}</div>
}

function ActivityToolDetail({ activity }: { activity: Exclude<Activity, { type: 'thinking' }> }) {
  const { open } = usePreview()
  const Renderer: ToolCallMessagePartComponent =
    assistantToolkit[activity.call.toolName]?.render ?? ToolCallRenderer
  const props: ToolCallMessagePartProps = {
    type: 'tool-call',
    toolCallId: activity.call.id,
    toolName: activity.call.toolName,
    args: activity.call.args as ToolCallMessagePartProps['args'],
    argsText: JSON.stringify(activity.call.args),
    result: activity.result,
    isError: activity.status === 'failed',
    status:
      activity.status === 'running'
        ? { type: 'running' }
        : activity.status === 'waiting'
          ? { type: 'requires-action', reason: 'tool-calls' }
          : activity.status === 'failed'
            ? { type: 'incomplete', reason: 'error', error: activity.result?.error }
            : { type: 'complete' },
    addResult: () => undefined,
    resume: () => undefined,
    respondToApproval: async () => undefined,
  }
  return (
    <ToolDetailProvider>
      {'path' in activity && activity.path && (
        <button
          type="button"
          className="mb-2 block max-w-full truncate text-left text-foreground hover:underline"
          onClick={() => open({ kind: 'workspace-file', path: activity.path! })}
        >
          {activity.path}
        </button>
      )}
      {(activity.type === 'edit' || activity.type === 'write') &&
        activity.additions !== undefined && (
          <p className="mb-2 text-[11px] tabular-nums text-faint-foreground">
            +{activity.additions} −{activity.deletions ?? 0}
          </p>
        )}
      {(activity.type === 'search' || activity.type === 'glob') && (
        <p className="mb-2 whitespace-pre-wrap break-words">
          {activity.type === 'search'
            ? `Query: ${activity.query ?? ''}`
            : `Pattern: ${activity.pattern ?? ''}`}
        </p>
      )}
      <Renderer {...props} />
    </ToolDetailProvider>
  )
}
