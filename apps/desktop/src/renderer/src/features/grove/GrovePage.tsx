import { useEffect, useState } from 'react'
import {
  defaultReceptionPolicy,
  type BotMessage,
  type BotReceptionPolicy,
} from '@kklyeenook/shared/bot/grove'
import { PageShell } from '../../components/page-shell'
import { useChatRuntimeSnapshot, useChatStore } from '../chat/runtime/chat-runtime'
import { Collaboration } from './collaboration'
import { GroveConnectionPanel } from './connection'
import { GroveConnectionsPanel } from './connections'
import { GrovePermissionsPanel } from './permissions'

export function GrovePage() {
  const store = useChatStore()
  const { bots } = useChatRuntimeSnapshot()
  const [policies, setPolicies] = useState<Record<string, BotReceptionPolicy>>({})
  const [messages, setMessages] = useState<BotMessage[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const state = await store.grove()
        if (active) {
          setPolicies(state.policies)
          setMessages(state.messages)
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : 'Grove 加载失败')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [store])
  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-semibold">Grove</h1>
        <p className="mt-2 text-sm text-muted-foreground">Bot 通信、连接与协作</p>
      </div>
      <div className="material-control divide-y overflow-hidden rounded-xl">
        <GroveConnectionPanel />
        <GroveConnectionsPanel />
        <GrovePermissionsPanel />
        <Collaboration />
        <section className="p-5">
          <h2 className="font-medium">My Bots · 接收策略</h2>
          <div className="mt-3 divide-y">
            {bots.map((bot) => {
              const policy = policies[bot.id] ?? defaultReceptionPolicy
              const save = async (update: Partial<BotReceptionPolicy>) => {
                try {
                  const next = { ...policy, ...update }
                  await store.setGrovePolicy(bot.id, next)
                  setPolicies((current) => ({ ...current, [bot.id]: next }))
                  setError('')
                } catch (error) {
                  setError(error instanceof Error ? error.message : '策略保存失败')
                }
              }
              return (
                <div key={bot.id} className="flex flex-wrap items-center gap-4 py-4 text-sm">
                  <span className="flex-1 font-medium">{bot.name}</span>
                  <label className="flex items-center gap-2">
                    消息
                    <input
                      type="checkbox"
                      checked={policy.messages}
                      onChange={(event) => void save({ messages: event.target.checked })}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    协作
                    <input
                      type="checkbox"
                      checked={policy.tasks}
                      onChange={(event) => void save({ tasks: event.target.checked })}
                    />
                  </label>
                </div>
              )
            })}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </section>
        <section className="p-5">
          <h2 className="font-medium">消息记录</h2>
          <div className="mt-3 divide-y">
            {messages
              .filter((message) => message.type === 'message')
              .slice()
              .reverse()
              .map((message) => (
                <div key={message.id} className="py-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {bots.find((bot) => bot.id === message.fromBotId)?.name ?? message.fromBotId} →{' '}
                    {bots.find((bot) => bot.id === message.toBotId)?.name ?? message.toBotId}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
            {messages.every((message) => message.type !== 'message') && (
              <p className="py-4 text-sm text-muted-foreground">暂无普通消息。</p>
            )}
          </div>
        </section>
      </div>
    </PageShell>
  )
}
