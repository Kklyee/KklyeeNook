import type { ToolCallMessagePartComponent } from '@assistant-ui/react'
import { useEffect, useState } from 'react'
import type { BotTask } from '@kklyeenook/shared/bot/grove'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { defaultBot } from '@kklyeenook/shared/bot/bot'
import { useChatStore, useChatRuntimeSnapshot } from '../runtime/chat-runtime'
import { normalizeToolResult } from '@kklyeenook/shared/tool/toolExecutionResult'

const states = {
  pending: '等待投递',
  accepted: '已接受任务',
  running: '正在执行',
  completed: '已完成',
  failed: '执行失败',
  rejected: '已拒绝',
  cancelled: '已取消',
}
export const CollaborationMessages: ToolCallMessagePartComponent = ({
  args,
  status,
  result,
  isError,
}) => {
  const store = useChatStore()
  const { selectedThreadId, bots } = useChatRuntimeSnapshot()
  const [tasks, setTasks] = useState<BotTask[]>([])
  const normalized = result === undefined ? undefined : normalizeToolResult(result, isError)
  const details = normalized?.details as { collaborationId?: string } | undefined
  const collaborationId = details?.collaborationId
  useEffect(() => {
    setTasks([])
    if (!collaborationId) return
    const unsubscribe = store.subscribeGrove((state) => {
      const tasks = state.tasks.filter((task) => task.sourceThreadId === selectedThreadId && task.id === collaborationId)
      setTasks(tasks)
      if (tasks.length && tasks.every((task) => ['completed', 'failed', 'rejected', 'cancelled'].includes(task.status))) unsubscribe()
    })
    return unsubscribe
  }, [store, selectedThreadId, collaborationId])
  return tasks.length ? (
    <div className="flex flex-col gap-2" aria-label="Bot 协作消息" aria-live="polite">
      {tasks.map((task) => {
        const bot = bots.find((bot) => bot.id === task.toBotId)
        const name = bot?.name ?? task.targetName ?? 'Bot 已不可用'
        const duration = Math.max(
          0,
          Math.round(
            ((['pending', 'accepted', 'running'].includes(task.status)
              ? Date.now()
              : task.updatedAt) -
              task.createdAt) /
              1000,
          ),
        )
        return (
          <details key={task.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
            <summary className="flex cursor-pointer items-start gap-2">
              <BotAvatar
                avatar={bot?.avatar ?? task.targetAvatar ?? defaultBot(task.toBotId, name).avatar}
                name={name}
                size={24}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{name}</span>
                  <span className="text-xs text-muted-foreground">
                    {states[task.status]} · {duration} 秒
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {task.instruction}
                </span>
                {task.result && <span className="mt-1 line-clamp-2 text-xs">{task.result}</span>}
              </span>
            </summary>
            <div className="mt-2 space-y-2 pl-8">
              <p className="whitespace-pre-wrap">{task.instruction}</p>
              {task.result && <p className="whitespace-pre-wrap border-t pt-2">{task.result}</p>}
            </div>
          </details>
        )
      })}
    </div>
  ) : (
    <div className="text-xs text-muted-foreground">
      {bots.find((bot) => bot.id === args.botId)?.name ?? 'Bot'} ·{' '}
      {normalized?.status === 'error'
        ? `提交失败：${normalized.error?.message ?? '请求失败'}`
        : status.type === 'running'
          ? '正在提交任务'
          : status.type === 'incomplete'
            ? '任务中断'
            : '任务已提交'}
    </div>
  )
}
