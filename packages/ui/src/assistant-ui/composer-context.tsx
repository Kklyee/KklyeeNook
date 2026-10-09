import type { ComponentProps } from 'react'
import { cn } from '../lib/utils'
import { ghostButton, mono } from '../lib/surfaces'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/popover'

interface ContextBudget {
  tokens?: number
  contextWindow?: number
  usedPercent?: number
  state: 'unknown' | 'normal' | 'warning' | 'critical' | 'compacting'
}

const labels = {
  unknown: '上下文预算未知',
  normal: '上下文预算充足',
  warning: '接近预计压缩边界',
  critical: '即将达到预计压缩边界',
  compacting: '正在整理上下文…',
}

function formatTokens(value?: number) {
  if (value === undefined) return '未知'
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(Math.round(value))
}

export function ComposerContext({ budget, className, ...props }: Omit<ComponentProps<'div'>, 'children'> & { budget: ContextBudget }) {
  const fraction = budget.usedPercent ?? 0
  const clamped = Math.min(1, Math.max(0, fraction))
  const warn = budget.state === 'warning' || budget.state === 'critical'
  const circumference = 2 * Math.PI * 6
  const status = labels[budget.state]

  return (
    <div data-slot="composer-context" data-state={budget.state} className={className} {...props}>
      <Popover>
        <PopoverTrigger
          aria-label={`上下文 ${formatTokens(budget.tokens)} / ${formatTokens(budget.contextWindow)}，${status}`}
          title={status}
          className={cn(ghostButton, 'text-foreground/80 h-6 gap-1.5 rounded-md px-1.5 text-[11px] font-normal tabular-nums', warn && 'text-red-500 dark:text-red-400')}
        >
          <svg viewBox="0 0 16 16" className="size-3 -rotate-90" aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-foreground/10" />
            <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-current transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped)} />
          </svg>
          <span>上下文 {budget.usedPercent === undefined ? '未知' : `${Math.round(fraction * 100)}%`}</span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={8} className="w-60 gap-3.5 rounded-2xl p-4">
          <div className="flex items-baseline justify-between">
            <PopoverTitle className="text-[13.5px]">当前上下文</PopoverTitle>
            <p className={cn(mono, 'tabular-nums', warn ? 'text-red-500 dark:text-red-400' : 'text-foreground/35')}>
              {budget.usedPercent === undefined ? '未知' : `${Math.round(fraction * 100)}%`}
            </p>
          </div>
          <div className="bg-foreground/[0.06] flex h-[5px] w-full overflow-hidden rounded-full">
            <span className="bg-foreground/80 h-full transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${clamped * 100}%` }} />
          </div>
          <div className="text-foreground/55 flex items-center justify-between text-[13px]">
            <span>占用 / 容量</span>
            <span className={cn(mono, 'text-foreground/40 tabular-nums')}>{formatTokens(budget.tokens)} / {formatTokens(budget.contextWindow)}</span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
