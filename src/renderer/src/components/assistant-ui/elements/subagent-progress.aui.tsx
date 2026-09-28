import { CheckIcon, CircleAlertIcon, ChevronRightIcon, LoaderCircleIcon } from 'lucide-react'

import { cn } from '@/renderer/src/lib/utils'
import { fieldInteractive, mono, ShimmerLabel } from '@/renderer/src/lib/surfaces'

export type SubagentProgressStatus = 'running' | 'completed' | 'failed' | 'aborted'

export interface SubagentProgressProps {
  name: string
  task: string
  status: SubagentProgressStatus
  summary?: string
  runId?: string
  onOpen?: () => void
}

export function SubagentProgress({
  name,
  task,
  status,
  summary,
  runId,
  onOpen,
}: SubagentProgressProps) {
  const running = status === 'running'
  const failed = status === 'failed' || status === 'aborted'

  return (
    <button
      type="button"
      disabled={!runId || !onOpen}
      onClick={onOpen}
      className={cn(
        fieldInteractive,
        'group flex w-full max-w-xl items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-left transition-colors disabled:cursor-default disabled:hover:bg-foreground/[0.04]',
      )}
      aria-label={`${name}：${task}`}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07]">
        {running ? (
          <LoaderCircleIcon className="size-3.5 animate-spin text-blue-500 motion-reduce:animate-none" />
        ) : failed ? (
          <CircleAlertIcon className="text-destructive size-3.5" />
        ) : (
          <CheckIcon className="size-3.5 text-emerald-500" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <ShimmerLabel active={running} className="shrink-0 text-xs font-medium">
            {name}
          </ShimmerLabel>
          <span className={cn(mono, 'min-w-0 truncate text-foreground/55')} title={task}>
            {task}
          </span>
        </span>
        {summary && (
          <span className="mt-1 block truncate text-[11px] text-foreground/40" title={summary}>
            {summary}
          </span>
        )}
      </span>
      {runId && (
        <ChevronRightIcon className="size-3.5 shrink-0 text-foreground/35 transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  )
}
