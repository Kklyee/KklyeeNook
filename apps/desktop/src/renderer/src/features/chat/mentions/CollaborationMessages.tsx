import { useEffect, useState } from 'react'
import type { BotTask } from '@kklyeenook/shared/bot/grove'
import type { NetworkBotIdentity } from '@kklyeenook/shared/bot/social'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { defaultBot } from '@kklyeenook/shared/bot/bot'
import { useChatStore, useChatRuntimeSnapshot } from '../runtime/chat-runtime'

const states = {
  pending: '等待投递',
  accepted: '已接受任务',
  running: '正在执行',
  completed: '已完成',
  failed: '执行失败',
  rejected: '已拒绝',
}
export function CollaborationMessages() {
  const store = useChatStore()
  const { selectedThreadId, bots } = useChatRuntimeSnapshot()
  const [tasks, setTasks] = useState<BotTask[]>([])
  const [contacts, setContacts] = useState<NetworkBotIdentity[]>([])
  useEffect(() => {
    let active = true
    setTasks([])
    const refresh = async () => {
      try {
        const state = await store.grove()
        if (active) {
          setTasks(state.tasks.filter((task) => task.sourceThreadId === selectedThreadId))
          setContacts(state.contacts ?? [])
        }
      } catch {}
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [store, selectedThreadId])
  return tasks.length ? (
    <div className="flex flex-col gap-2" aria-label="Bot 协作消息" aria-live="polite">
      {tasks.map((task) => {
        const bot =
          bots.find((bot) => bot.id === task.toBotId) ??
          contacts.find((bot) => bot.networkId === task.toBotId)
        const name = bot?.name ?? task.toBotId
        return (
          <details key={task.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
            <summary className="flex cursor-pointer items-center gap-2">
              <BotAvatar
                avatar={bot?.avatar ?? defaultBot(task.toBotId, name).avatar}
                name={name}
                size={24}
              />
              <span className="font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">
                {states[task.status]}
                {task.remote?.direction === 'outgoing' && task.status === 'pending'
                  ? ' · 离线时自动重试'
                  : ''}
              </span>
            </summary>
            <div className="mt-2 space-y-2 pl-8">
              <p className="text-xs text-muted-foreground">
                耗时：
                {Math.max(
                  0,
                  Math.round(
                    ((['pending', 'accepted', 'running'].includes(task.status)
                      ? Date.now()
                      : task.updatedAt) -
                      task.createdAt) /
                      1000,
                  ),
                )}{' '}
                秒 · {task.id}
              </p>
              <p className="whitespace-pre-wrap">{task.instruction}</p>
              {task.result && <p className="whitespace-pre-wrap border-t pt-2">{task.result}</p>}
            </div>
          </details>
        )
      })}
    </div>
  ) : null
}
