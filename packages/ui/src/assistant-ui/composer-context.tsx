import type { ComponentProps } from 'react'
import { cn } from '../lib/utils'
import { ghostButton, mono } from '../lib/surfaces'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/popover'

interface ContextBudget {
  tokens?: number
  contextWindow?: number
  usedPercent?: number
  state: 'unknown' | 'normal' | 'warning' | 'critical' | 'compacting'
  breakdown?: { system: number; tools: number; files: number; toolResults: number; conversation: number }
  latestRequest?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  estimated?: boolean
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
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(Math.round(value))
}

export function ComposerContext({ budget, className, ...props }: Omit<ComponentProps<'div'>, 'children'> & { budget: ContextBudget }) {
  const fraction = budget.usedPercent ?? 0
  const clamped = Math.min(1, Math.max(0, fraction))
  const warn = budget.state === 'warning' || budget.state === 'critical'
  const circumference = 2 * Math.PI * 6
  const status = labels[budget.state]
  const percent = budget.usedPercent === undefined ? '未知' : `${Number((fraction * 100).toFixed(1))}%`
  const categories: readonly (readonly [string, number, string])[] = budget.breakdown ? [
    ['系统提示词', budget.breakdown.system, 'bg-violet-400'],
    ['工具定义', budget.breakdown.tools, 'bg-sky-400'],
    ['文件', budget.breakdown.files, 'bg-emerald-400'],
    ['工具结果', budget.breakdown.toolResults, 'bg-pink-400'],
    ['会话内容', budget.breakdown.conversation, 'bg-indigo-400'],
  ] : []
  const categoryTokens = categories.reduce((sum, [, tokens]) => sum + tokens, 0)
  const request = budget.latestRequest

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
          <span>上下文 {percent}</span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={8} className="w-64 gap-3 rounded-2xl p-4">
          <div className="flex items-baseline justify-between">
            <PopoverTitle className="text-[13.5px]">当前上下文</PopoverTitle>
            <p className={cn(mono, 'text-right tabular-nums', warn ? 'text-red-500 dark:text-red-400' : 'text-foreground/35')}>
              {percent}
            </p>
          </div>
          <div className="bg-foreground/[0.06] flex h-[5px] w-full overflow-hidden rounded-full">
            <span className="bg-foreground/80 h-full transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${clamped * 100}%` }} />
          </div>
          <div className="text-foreground/55 flex items-center justify-between text-[13px]">
            <span>占用 / 容量</span>
            <span title={budget.tokens?.toLocaleString('en-US')} className={cn(mono, 'text-foreground/40 text-right tabular-nums')}>{budget.estimated && '~'}{formatTokens(budget.tokens)} / {formatTokens(budget.contextWindow)}</span>
          </div>
          {categories.length > 0 && (
            <div className="border-border/60 flex flex-col gap-2 border-t pt-3">
              <p className="text-muted-foreground text-xs">分类估算</p>
              <div className="flex h-1.5 items-stretch overflow-hidden" aria-hidden>
                {categories.map(([label, tokens, color]) => (
                  <span key={label} className={cn('block h-full shrink-0', color)} style={{ width: `${categoryTokens > 0 ? tokens / categoryTokens * 100 : 0}%` }} />
                ))}
              </div>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-xs">
                {categories.map(([label, tokens, color]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground grid grid-cols-[0.375rem_1fr] items-center gap-2"><span className={cn('size-1.5 rounded-sm', color)} />{label}</dt>
                    <dd title={tokens.toLocaleString('en-US')} className={cn(mono, 'text-right tabular-nums')}>~{formatTokens(tokens)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {request && (
            <dl className="border-border/60 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t pt-3 text-xs">
              <dt className="text-muted-foreground">最近输入</dt><dd title={request.input.toLocaleString('en-US')} className={cn(mono, 'text-right tabular-nums')}>{formatTokens(request.input)}</dd>
              <dt className="text-muted-foreground">缓存命中</dt><dd className={cn(mono, 'text-right tabular-nums')}>{request.input > 0 ? `${(request.cacheRead / request.input * 100).toFixed(1)}%` : '—'}</dd>
            </dl>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
