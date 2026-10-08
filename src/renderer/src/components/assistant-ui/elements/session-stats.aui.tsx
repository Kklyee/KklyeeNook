import { useMemo, type ReactNode } from 'react'
import { usePiThreadState, type PiAssistantMessage } from '@assistant-ui/react-pi'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/renderer/src/components/ui/popover'

const tokenFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const numberFormatter = new Intl.NumberFormat('en')

export function SessionStats({ children }: { children?: ReactNode }) {
  const messages = usePiThreadState((state) => state.messages)
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
      const assistant = message as PiAssistantMessage
      steps += 1
      tools += assistant.content.filter((part) => part.type === 'toolCall').length
      input += assistant.usage.input
      output += assistant.usage.output
      cacheRead += assistant.usage.cacheRead
      cacheWrite += assistant.usage.cacheWrite
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

  return (
    <div
      data-slot="aui-session-stats"
      aria-label="会话统计"
      className="text-primary/85 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 pt-0.5 text-[11px] leading-5 tabular-nums"
    >
      <div className="flex shrink-0 items-center gap-2">
        <span title="当前会话分支：每条用户消息计为一轮，每次模型调用计为一步，包含正在生成的步骤">
          {stats.rounds} 轮 - {stats.steps} 步
        </span>
        <span aria-hidden="true" className="text-primary/35">
          ·
        </span>
        <span title="模型发起的工具调用次数">{stats.tools} 次工具调用</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Popover>
          <PopoverTrigger
            className="hover:bg-primary/10 focus-visible:ring-primary/50 -mx-1.5 inline-flex h-6 items-center rounded-md px-1.5 outline-none transition-colors focus-visible:ring-2"
            aria-label="查看累计 Token 用量明细"
          >
            累计 {tokenFormatter.format(stats.totalTokens)} Token（含缓存）
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
                <dd className="text-primary tabular-nums">{stats.cacheRate}</dd>
              </div>
            </dl>
          </PopoverContent>
        </Popover>
        <span aria-hidden="true" className="text-primary/35">
          ·
        </span>
        <span title="缓存命中率 = 缓存读取 Token ÷（输入 + 缓存读取 + 缓存写入 Token）；用量在模型返回后更新，统计范围为当前会话分支的已加载消息">
          缓存 {stats.cacheRate}
        </span>
        {children}
      </div>
    </div>
  )
}
