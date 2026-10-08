import { useMemo, type ReactNode } from 'react'
import { usePiThreadState, type PiAssistantMessage } from '@assistant-ui/react-pi'

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
        <span
          title={`累计用量为各次模型调用的 Token 总和，历史上下文重复发送会重复计入，不等于当前上下文占用。输入 ${numberFormatter.format(stats.input)} · 输出 ${numberFormatter.format(stats.output)} · 缓存读取 ${numberFormatter.format(stats.cacheRead)} · 缓存写入 ${numberFormatter.format(stats.cacheWrite)}`}
        >
          累计 {tokenFormatter.format(stats.totalTokens)} Token（含缓存）
        </span>
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
