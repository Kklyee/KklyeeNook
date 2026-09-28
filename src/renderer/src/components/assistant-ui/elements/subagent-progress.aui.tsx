import { ChevronRightIcon } from 'lucide-react'

import { cn } from '@/renderer/src/lib/utils'
import { fieldInteractive, mono, ShimmerLabel } from '@/renderer/src/lib/surfaces'
import { SubagentAvatar } from './subagent-avatar.aui'
import type { SubagentAvatar as SubagentAvatarValue } from '@/shared/agent/delegateTask'

export type SubagentProgressStatus = 'running' | 'completed' | 'failed' | 'aborted'

export interface SubagentProgressProps {
  name: string
  avatar?: SubagentAvatarValue
  task: string
  status: SubagentProgressStatus
  runId?: string
  onOpen?: () => void
}

export function SubagentProgress({
  name,
  avatar,
  task,
  status,
  runId,
  onOpen,
}: SubagentProgressProps) {
  const running = status === 'running'
  return (
    <button
      type="button"
      disabled={!runId || !onOpen}
      onClick={onOpen}
      className={cn(
        fieldInteractive,
        'group flex w-full max-w-xl items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-left transition-colors disabled:cursor-default disabled:hover:bg-foreground/[0.04]',
        running && 'border-blue-400/30',
        running && 'shimmer shimmer-bg motion-reduce:animate-none',
      )}
      aria-label={`${name}：${task}`}
    >
      <SubagentAvatar avatar={avatar} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <ShimmerLabel active={running} className="shrink-0 text-xs font-medium">
            {name}
          </ShimmerLabel>
          <ShimmerLabel
            active={running}
            className={cn(mono, 'min-w-0 truncate text-foreground/55')}
            title={task}
          >
            {task}
          </ShimmerLabel>
        </span>
      </span>
      {runId && (
        <ChevronRightIcon className="size-3.5 shrink-0 text-foreground/35 transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  )
}
