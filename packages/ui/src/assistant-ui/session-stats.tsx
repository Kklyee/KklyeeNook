import { useMemo, type ReactNode } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '../components/popover'

const tokenFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const numberFormatter = new Intl.NumberFormat('en')

interface SessionMessage {
  role: string
  content?: string | readonly { type: string; name?: string }[]
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export function SessionStats({ messages, contextUsage, showContext = false, compact = false, children }: {
  messages: readonly SessionMessage[]
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null }
  showContext?: boolean
  compact?: boolean
  children?: ReactNode
}) {
  const stats = useMemo(() => {
    let rounds = 0
    let steps = 0
    let tools = 0
    let input = 0
    let output = 0
    let cacheRead = 0
    let cacheWrite = 0

    for (const message of messages) {
      if (message.role === 'user') rounds += 1
      if (message.role !== 'assistant') continue
      steps += 1
      if (Array.isArray(message.content)) {
        tools += message.content.filter((part) => part.type === 'toolCall' || (part.type === 'data' && part.name === 'tool-call')).length
      }
      if (message.usage) {
        input += message.usage.input
        output += message.usage.output
        cacheRead += message.usage.cacheRead
        cacheWrite += message.usage.cacheWrite
      }
    }

    const promptTokens = input + cacheRead + cacheWrite
    return {
      rounds,
      steps,
      tools,
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens: promptTokens + output,
      cacheRate: promptTokens > 0 ? `${((cacheRead / promptTokens) * 100).toFixed(1)}%` : '—',
    }
  }, [messages])

  if (messages.length === 0) return null

  return (
    <div
      data-slot="aui-session-stats"
      aria-label="会话统计"
      className={compact
        ? 'text-foreground/80 flex min-w-0 items-center justify-between gap-2 overflow-x-auto whitespace-nowrap px-1 pt-0.5 text-[10px] leading-5 tabular-nums [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        : 'text-foreground/80 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 pt-0.5 text-[11px] leading-5 tabular-nums'}
    >
      <div className={compact ? 'flex shrink-0 items-center gap-1' : 'flex shrink-0 items-center gap-2'}>
        <span title="当前会话分支：每条用户消息计为一轮，每次模型调用计为一步，包含正在生成的步骤">
          {compact ? `${stats.rounds}轮/${stats.steps}步` : `${stats.rounds} 轮 - ${stats.steps} 步`}
        </span>
        <span aria-hidden="true" className="text-foreground/30">
          ·
        </span>
        <span title="模型发起的工具调用次数">{stats.tools} {compact ? '工具' : '次工具调用'}</span>
      </div>
      <div className={compact ? 'flex shrink-0 items-center gap-1' : 'flex flex-wrap items-center gap-x-2 gap-y-1'}>
        <Popover>
          <PopoverTrigger
            className="hover:bg-hover focus-visible:ring-ring -mx-1.5 inline-flex h-6 items-center rounded-md px-1.5 outline-none transition-colors focus-visible:ring-2"
            aria-label="查看累计 Token 用量明细"
          >
            {!compact && '累计 '}{tokenFormatter.format(stats.totalTokens)} Token
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-64 gap-3 rounded-2xl p-4"
          >
            <PopoverTitle>累计 Token 用量</PopoverTitle>
            <dl className="flex flex-col gap-2 text-xs">
              {(
                [
                  ['未缓存输入', stats.input],
                  ['缓存读取', stats.cacheRead],
                  ...(stats.cacheWrite > 0 ? [['缓存写入', stats.cacheWrite] as const] : []),
                  ['输出', stats.output],
                ] satisfies (readonly [string, number])[]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-foreground tabular-nums">{numberFormatter.format(value)}</dd>
                </div>
              ))}
              <div className="border-border/60 mt-1 flex items-center justify-between gap-4 border-t pt-3">
                <dt className="text-muted-foreground">合计</dt>
                <dd className="text-foreground font-medium tabular-nums">
                  {numberFormatter.format(stats.totalTokens)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">缓存命中率</dt>
                <dd className="text-foreground tabular-nums">{stats.cacheRate}</dd>
              </div>
            </dl>
          </PopoverContent>
        </Popover>
        <span aria-hidden="true" className="text-foreground/30">
          ·
        </span>
        <span title="缓存命中率 = 缓存读取 Token ÷（输入 + 缓存读取 + 缓存写入 Token）；用量在模型返回后更新，统计范围为当前会话分支的已加载消息">
          缓存 {stats.cacheRate}
        </span>
        {(showContext || contextUsage) && (
          <Popover>
            <PopoverTrigger
              className="hover:bg-hover focus-visible:ring-ring inline-flex min-h-6 items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-2"
              aria-label="查看上下文窗口用量"
            >
              上下文 {contextUsage?.percent == null ? '未知' : `${Math.round(contextUsage.percent)}%`}
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={8} className="w-64 gap-3 rounded-2xl p-4">
              <PopoverTitle>当前上下文窗口</PopoverTitle>
              <dl className="flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">已占用</dt>
                  <dd>{contextUsage?.tokens == null ? '未知' : `${numberFormatter.format(contextUsage.tokens)} Token`}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">窗口容量</dt>
                  <dd>{contextUsage && contextUsage.contextWindow > 0 ? `${numberFormatter.format(contextUsage.contextWindow)} Token` : '未知'}</dd>
                </div>
              </dl>
            </PopoverContent>
          </Popover>
        )}
        {children}
      </div>
    </div>
  )
}
