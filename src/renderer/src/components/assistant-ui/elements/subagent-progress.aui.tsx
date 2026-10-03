import { ChevronRightIcon } from 'lucide-react'

import { cn } from '@/renderer/src/lib/utils'
import { mono } from '@/renderer/src/lib/surfaces'
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
  const statusLabel =
    status === 'running'
      ? 'Running'
      : status === 'completed'
        ? 'Completed'
        : status === 'failed'
          ? 'Failed'
          : 'Aborted'
  return (
    <button
      type="button"
      disabled={!runId || !onOpen}
      onClick={onOpen}
      className={cn(
        'group flex w-full max-w-xl items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent',
      )}
      aria-label={`${name}：${task}`}
    >
      <SubagentAvatar avatar={avatar} className="bg-surface-muted text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-foreground">{name}</span>
          <span className={cn(mono, 'min-w-0 truncate text-muted-foreground')} title={task}>
            {task}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-[10px] text-faint-foreground">{statusLabel}</span>
      {runId && (
        <ChevronRightIcon className="size-3.5 shrink-0 rounded-sm text-faint-foreground transition-[color,background-color,transform] group-hover:text-foreground hover:bg-hover group-hover:translate-x-0.5" />
      )}
    </button>
  )
}
