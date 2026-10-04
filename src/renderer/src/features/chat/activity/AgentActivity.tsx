import { memo, useState } from 'react'
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  WrenchIcon,
} from 'lucide-react'
import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from '@assistant-ui/react'
import type { AgentActivity as Activity } from '@/shared/agent/agentActivity'
import { formatActivityLabel } from '@/shared/agent/agentActivityFormatter'
import { activityDuration, formatDuration } from '@/shared/agent/agentActivityTiming'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/renderer/src/components/ui/collapsible'
import { ToolDetailProvider, ToolIcon } from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { ToolCallRenderer } from '../tools/ToolCallRenderer'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { cn } from '@/renderer/src/lib/utils'
import { collapsePanel } from '@/renderer/src/lib/surfaces'
import { usePreview } from '../../preview/PreviewProvider'

export function ActivityIcon({ activity }: { activity: Activity }) {
  if (
    activity.status !== 'failed' &&
    activity.type !== 'approval' &&
    activity.type !== 'tool'
  )
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
    activity.status === 'failed' || activity.type === 'approval'
      ? CircleAlertIcon
      : WrenchIcon
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

export function ActivityDuration({ activity, now }: { activity: Activity; now: number }) {
  return (
    <span className="shrink-0 text-[11px] tabular-nums text-faint-foreground">
      {formatDuration(activityDuration(activity, now))}
    </span>
  )
}

export const AgentActivityRow = memo(function AgentActivityRow({
  activity,
  now,
}: {
  activity: Activity
  now: number
}) {
  const [open, setOpen] = useState(false)
  const label = formatActivityLabel(activity)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="agent-activity"
      data-activity-type={activity.type}
      data-activity-status={activity.status}
      style={{ '--animation-duration': '200ms' } as React.CSSProperties}
    >
      <CollapsibleTrigger className="group/trigger flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-[13px] text-foreground outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-border-strong">
        <ActivityIcon activity={activity} />
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
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
        {activity.status === 'completed' && activity.type !== 'thinking' && (
          <CheckIcon
            aria-hidden="true"
            strokeWidth={1.5}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <ActivityDuration activity={activity} now={now} />
        <ChevronRightIcon
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-3.5 shrink-0 text-faint-foreground transition-transform group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, 'outline-none')}>
        {open && (
          <div className="ml-5 min-w-0 border-l border-border px-3 py-2 text-xs text-muted-foreground">
            {activity.type === 'thinking' ? (
              <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                {activity.content || '模型未返回 reasoning 内容。'}
              </div>
            ) : (
              <ActivityToolDetail activity={activity} />
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
})

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
