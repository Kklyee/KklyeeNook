'use client'

import type { ComponentProps, ReactNode } from 'react'
import { ChevronDownIcon, Clock3Icon, LayersIcon, WrenchIcon } from 'lucide-react'
import { cn } from '@/renderer/src/lib/utils'
import { mono } from '@/renderer/src/lib/surfaces'

export type TraceTone = 'system' | 'user' | 'assistant' | 'tool' | 'approval' | 'failed'

export interface TraceSegment {
  id: string
  label: string
  startMs: number
  durationMs: number
  tone: TraceTone
}

export interface TraceLane {
  id: string
  label: string
  segments: readonly TraceSegment[]
}

const TONE: Record<TraceTone, string> = {
  system: 'bg-foreground/60',
  user: 'bg-blue-400/75',
  assistant: 'bg-violet-400/65',
  tool: 'bg-amber-400/75',
  approval: 'bg-emerald-400/60',
  failed: 'bg-red-400/80',
}

export function TraceWaterfall({
  lanes,
  totalMs,
  turnCount,
  toolCount,
  turnsExpanded,
  toolsExpanded,
  onToggleTurns,
  onToggleTools,
  toolbar,
  selectedSegmentId,
  onSegmentSelect,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  lanes: readonly TraceLane[]
  totalMs: number
  turnCount: number
  toolCount: number
  turnsExpanded?: boolean
  toolsExpanded?: boolean
  onToggleTurns?: () => void
  onToggleTools?: () => void
  toolbar?: ReactNode
  selectedSegmentId?: string
  onSegmentSelect?: (segmentId: string) => void
}) {
  const total = Math.max(totalMs, 1)

  return (
    <div
      data-slot="trace-waterfall"
      className={cn('w-full shrink-0 overflow-hidden border-b border-border/60 bg-foreground/[0.018]', className)}
      {...props}
    >
      <div className="flex h-[28px] items-center gap-[12px] px-[8px]">
        <Metric icon={Clock3Icon} label="时长" value={formatDuration(totalMs)} />
        <Metric icon={LayersIcon} label="轮次" value={String(turnCount)} expanded={turnsExpanded} onToggle={onToggleTurns} />
        <Metric icon={WrenchIcon} label="调用" value={String(toolCount)} expanded={toolsExpanded} onToggle={onToggleTools} />
        {toolbar && <div className="ml-auto min-w-0">{toolbar}</div>}
      </div>

      <div className="relative border-t border-border/35 bg-foreground/[0.025] py-[5px]">
        {lanes.map((lane) => (
          <div key={lane.id} className="grid h-[12px] grid-cols-[32px_minmax(0,1fr)] items-center">
            <span className="whitespace-nowrap px-[6px] text-[9px] leading-[12px] text-foreground/40">{lane.label}</span>
            <span className="relative mr-[8px] h-[6px] overflow-hidden bg-foreground/[0.035]">
              {lane.segments.map((segment) => {
                const left = Math.min(99.4, Math.max(0, percent(segment.startMs, total)))
                const width = Math.min(
                  100 - left,
                  Math.max(0.6, percent(segment.durationMs, total)),
                )
                return (
                  <button
                    type="button"
                    key={segment.id}
                    aria-label={`${segment.label}，${formatDuration(segment.durationMs)}`}
                    title={`${segment.label} · ${formatDuration(segment.durationMs)}`}
                    onClick={() => onSegmentSelect?.(segment.id)}
                    className={cn(
                      'absolute inset-y-0 cursor-pointer outline-none transition-[filter,box-shadow] hover:z-10 hover:brightness-125 focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-foreground/70',
                      TONE[segment.tone],
                      selectedSegmentId === segment.id &&
                        'z-10 ring-1 ring-foreground/85 brightness-125',
                    )}
                    style={{ insetInlineStart: `${left}%`, width: `${width}%` }}
                  />
                )
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ icon: Icon, label, value, expanded, onToggle }: {
  icon: typeof Clock3Icon
  label: string
  value: string
  expanded?: boolean
  onToggle?: () => void
}) {
  const className = 'flex shrink-0 items-center gap-1 text-[10px] text-foreground/50'
  const content = (
    <>
      <Icon className="size-2.5" aria-hidden />
      <span>{label}</span>
      <span className={cn(mono, 'text-[10px] text-foreground/65 tabular-nums')}>{value}</span>
      {onToggle && <ChevronDownIcon className={cn('size-2.5 transition-transform', !expanded && '-rotate-90')} aria-hidden />}
    </>
  )

  if (!onToggle) return <span className={className}>{content}</span>

  const labelText = `${expanded ? '收起' : '展开'}所有${label}`
  return (
    <button
      type="button"
      aria-label={labelText}
      aria-expanded={expanded}
      aria-controls="execution-trace-runs"
      title={labelText}
      onClick={onToggle}
      className={cn(className, 'rounded-sm py-1 transition-colors hover:text-foreground/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60')}
    >
      {content}
    </button>
  )
}

function percent(value: number, total: number) {
  return (value / total) * 100
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.max(0, durationMs)}ms`
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
}
