'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import {
  useScrollLock,
  useToolCallElapsed,
  type ToolCallMessagePartStatus,
} from '@assistant-ui/react'

import bashIcon from '@/renderer/src/assets/icon/bash.svg'
import editFileIcon from '@/renderer/src/assets/icon/edit-file.svg'
import readFileIcon from '@/renderer/src/assets/icon/read-file.svg'
import writeFileIcon from '@/renderer/src/assets/icon/write-file.svg'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/renderer/src/components/ui/collapsible'
import { cn } from '@/renderer/src/lib/utils'
import { collapsePanel, ShimmerLabel } from '@/renderer/src/lib/surfaces'

const ANIMATION_DURATION = 200

export type ToolIconKind = 'read' | 'bash' | 'edit' | 'write' | 'agent' | 'generic'

export interface ToolCardProps {
  toolName: string
  label: string
  summary?: string
  status?: ToolCallMessagePartStatus
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
  className?: string
}

const iconAssets: Partial<Record<ToolIconKind, string>> = {
  read: readFileIcon,
  bash: bashIcon,
  edit: editFileIcon,
  write: writeFileIcon,
}

export function getToolIconKind(toolName: string): ToolIconKind {
  const name = toolName.toLowerCase()
  if (name.includes('read')) return 'read'
  if (name.includes('bash') || name.includes('shell') || name.includes('command')) return 'bash'
  if (name.includes('edit')) return 'edit'
  if (name.includes('write')) return 'write'
  if (name.includes('delegate') || name.includes('subagent')) return 'agent'
  return 'generic'
}

export function getToolDisplayName(toolName: string): string {
  const labels: Record<string, string> = {
    read: 'Read file',
    bash: 'Bash',
    edit: 'Edit file',
    write: 'Write file',
    delegate_task: 'Subagent',
  }
  return labels[toolName] ?? toolName
}

function ToolIcon({ kind }: { kind: ToolIconKind }) {
  const icon = iconAssets[kind]
  const className = 'size-3.5 shrink-0 text-muted-foreground'

  if (icon) {
    return (
      <span
        aria-hidden="true"
        className={cn('shrink-0 bg-current', className)}
        style={{
          maskImage: `url("${icon}")`,
          maskPosition: 'center',
          maskRepeat: 'no-repeat',
          maskSize: 'contain',
          WebkitMaskImage: `url("${icon}")`,
          WebkitMaskPosition: 'center',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
        }}
      />
    )
  }

  const Icon = kind === 'agent' ? BotIcon : WrenchIcon
  return <Icon aria-hidden="true" className={className} />
}

function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function ToolDetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-1.5">
      <p className="text-[10px] font-medium text-faint-foreground">{label}</p>
      {children}
    </section>
  )
}

export const toolCodeClassName =
  'max-h-72 overflow-auto rounded-md border border-border bg-surface-muted p-2 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-foreground'

export function ToolCard({
  toolName,
  label,
  summary,
  status,
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  className,
}: ToolCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(cardRef, ANIMATION_DURATION)
  const elapsedMs = useToolCallElapsed()
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const statusType = status?.type ?? 'complete'
  const isShimmerActive = statusType === 'running' || statusType === 'requires-action'
  const StatusIcon = isShimmerActive ? null : statusType === 'complete' ? CheckIcon : XCircleIcon
  const statusClassName =
    statusType === 'complete'
      ? 'text-success'
      : status?.type === 'incomplete' && status.reason === 'cancelled'
        ? 'text-faint-foreground'
        : 'text-danger'

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      lockScroll()
      if (!isControlled) setUncontrolledOpen(nextOpen)
      controlledOnOpenChange?.(nextOpen)
    },
    [controlledOnOpenChange, isControlled, lockScroll],
  )

  return (
    <Collapsible
      ref={cardRef}
      data-slot="tool-card"
      data-running={statusType === 'running' ? 'true' : undefined}
      aria-busy={statusType === 'running'}
      open={open}
      onOpenChange={handleOpenChange}
      style={{ '--animation-duration': `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      className={cn(
        'bg-surface-muted border border-border relative w-full overflow-hidden rounded-lg transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[var(--ui-shadow-raised)]',
        className,
      )}
    >
      <CollapsibleTrigger className="group/trigger flex h-8 w-full min-w-0 items-center gap-2 bg-transparent px-2.5 text-left outline-none hover:bg-hover data-[state=open]:bg-selected focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-strong">
        <ToolIcon kind={getToolIconKind(toolName)} />
        <ShimmerLabel
          active={isShimmerActive}
          className="shimmer-speed-100 shimmer-repeat-delay-0 shrink-0 truncate text-[13px] font-medium text-foreground"
          title={label}
        >
          {label}
        </ShimmerLabel>
        <ShimmerLabel
          active={isShimmerActive}
          className="shimmer-speed-100 shimmer-repeat-delay-0 min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
          title={summary}
        >
          {summary}
        </ShimmerLabel>
        {StatusIcon && (
          <StatusIcon aria-hidden="true" className={cn('size-3.5 shrink-0', statusClassName)} />
        )}
        {elapsedMs !== undefined && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint-foreground">
            {formatToolDuration(elapsedMs)}
          </span>
        )}
        <ChevronRightIcon className="size-3.5 shrink-0 text-faint-foreground transition-[color,transform] group-hover/trigger:text-foreground group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, 'outline-none')}>
        <div className="flex min-w-0 flex-col gap-2 border-t border-border px-2.5 py-2.5 text-xs">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
