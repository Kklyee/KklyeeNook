import { useMemo, type ReactNode } from 'react'
import { ChartNoAxesColumnIncreasingIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/popover'

const numberFormatter = new Intl.NumberFormat('en')

interface SessionMessage {
  role: string
  content?: string | readonly { type: string; name?: string }[]
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export function SessionStats({
  messages,
  ready,
  compact = false,
  status,
  children,
}: {
  messages: readonly SessionMessage[]
  ready: boolean
  compact?: boolean
  status?: ReactNode
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
        tools += message.content.filter(
          (part) => part.type === 'toolCall' || (part.type === 'data' && part.name === 'tool-call'),
        ).length
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

  if (!ready) return null

  return (
    <div
      data-slot="aui-session-stats"
      aria-label="会话状态"
      className={[
        compact
          ? 'flex h-7 min-w-0 items-center gap-2 px-1 text-[10px] text-muted-foreground'
          : 'flex h-7 min-w-0 items-center gap-2 px-3 text-[11px] text-muted-foreground',
        status ? 'justify-between' : 'justify-start',
      ].join(' ')}
    >
      {status && (
        <span role="status" className="min-w-0 truncate">
          {status}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1 tabular-nums">
        {children}
        <Popover>
          <PopoverTrigger
            aria-label="查看会话统计"
            title="会话统计"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ChartNoAxesColumnIncreasingIcon className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-64 max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-4"
          >
            <PopoverTitle>会话统计</PopoverTitle>
            <dl className="flex flex-col gap-2 text-xs">
              {(
                [
                  ['轮数', stats.rounds],
                  ['步骤', stats.steps],
                  ['工具调用', stats.tools],
                  ['未缓存输入 Token', stats.input],
                  ['缓存读取 Token', stats.cacheRead],
                  ['缓存写入 Token', stats.cacheWrite],
                  ['输出 Token', stats.output],
                  ['累计 Token', stats.totalTokens],
                ] satisfies (readonly [string, number])[]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-foreground tabular-nums">{numberFormatter.format(value)}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-2">
                <dt className="text-muted-foreground">累计缓存命中率</dt>
                <dd className="text-foreground tabular-nums">{stats.cacheRate}</dd>
              </div>
            </dl>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
