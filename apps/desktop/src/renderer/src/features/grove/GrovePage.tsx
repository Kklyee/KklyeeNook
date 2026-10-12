import { useEffect, useState } from 'react'
import {
  defaultReceptionPolicy,
  type BotMessage,
  type BotReceptionPolicy,
  type BotTask,
} from '@kklyeenook/shared/bot/grove'
import type { NetworkBotIdentity } from '@kklyeenook/shared/bot/social'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageShell } from '../../components/page-shell'
import { useChatRuntimeSnapshot, useChatStore } from '../chat/runtime/chat-runtime'
import { Collaboration } from './collaboration'
import { GroveConnectionPanel } from './connection'
import { GroveConnectionsPanel } from './connections'
import { GrovePermissionsPanel } from './permissions'
import { GroveSharedToolsPanel } from './shared-tools'
import { GroveActivityPanel } from './activity'

const views = ['Overview', 'Connections', 'Permissions', 'Shared Tools', 'Activity'] as const

export function GrovePage() {
  const store = useChatStore()
  const { bots } = useChatRuntimeSnapshot()
  const [policies, setPolicies] = useState<Record<string, BotReceptionPolicy>>({})
  const [messages, setMessages] = useState<BotMessage[]>([])
  const [error, setError] = useState('')
  const [view, setView] = useState<(typeof views)[number]>('Overview')
  const [tasks, setTasks] = useState<BotTask[]>([])
  const [contacts, setContacts] = useState<NetworkBotIdentity[]>([])
  const [network, setNetwork] = useState<{ enabled: boolean; error?: string }>({ enabled: false })
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const state = await store.grove()
        if (active) {
          setPolicies(state.policies)
          setMessages(state.messages)
          setTasks(state.tasks)
          setContacts(state.contacts ?? [])
          setNetwork(state.network ?? { enabled: false })
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
      <nav aria-label="Grove 页面" className="flex flex-wrap gap-2">
        {views.map((item) => (
          <Button
            key={item}
            size="sm"
            variant={view === item ? 'default' : 'ghost'}
            aria-current={view === item ? 'page' : undefined}
            onClick={() => setView(item)}
          >
            {item}
          </Button>
        ))}
      </nav>
      <div className="material-control divide-y overflow-hidden rounded-xl">
        {view === 'Overview' && (
          <>
            <section className="p-5 text-sm">
              <h2 className="font-medium">协作概览</h2>
              <div className="mt-3 divide-y">
                <p className="py-3">
                  我的 Bot：{bots.length} · 远程 Bot：{contacts.length}
                </p>
                <p className="py-3">
                  进行中的任务：
                  {
                    tasks.filter((task) => ['pending', 'accepted', 'running'].includes(task.status))
                      .length
                  }
                </p>
                <p className="py-3">
                  网络：{network.enabled ? '已启用' : '未启用'}
                  {network.error ? ` · ${network.error}` : ''}
                </p>
              </div>
            </section>
            <Collaboration />
          </>
        )}
        {view === 'Connections' && (
          <>
            <GroveConnectionPanel />
            <GroveConnectionsPanel />
          </>
        )}
        {view === 'Permissions' && <GrovePermissionsPanel />}
        {view === 'Shared Tools' && <GroveSharedToolsPanel />}
        {(view === 'Overview' || view === 'Connections' || view === 'Permissions') && (
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
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer font-medium">{bot.name}</summary>
                      <p className="mt-2 break-all text-xs text-muted-foreground">
                        {bot.id} · {bot.role} · 已启用 {bot.enabledTools.length} 项工具
                      </p>
                    </details>
                    <label className="flex items-center gap-2">
                      消息
                      <input
                        type="checkbox"
                        checked={policy.messages}
                        onChange={(event) => void save({ messages: event.target.checked })}
                      />
                    </label>
                    <label className="w-full text-xs text-muted-foreground">
                      允许的来源 Bot ID（以逗号分隔，留空允许所有已授权来源）
                      <Input
                        key={policy.allowedBotIds?.join(',') ?? ''}
                        defaultValue={policy.allowedBotIds?.join(', ') ?? ''}
                        onBlur={(event) => {
                          const ids = event.target.value
                            .split(',')
                            .map((id) => id.trim())
                            .filter(Boolean)
                          if (ids.join(',') !== (policy.allowedBotIds ?? []).join(','))
                            void save({ allowedBotIds: ids.length ? [...new Set(ids)] : null })
                        }}
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
        )}
        {view === 'Activity' && (
          <>
            <Collaboration />
            <GroveActivityPanel />
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
                        {bots.find((bot) => bot.id === message.fromBotId)?.name ??
                          message.fromBotId}{' '}
                        → {bots.find((bot) => bot.id === message.toBotId)?.name ?? message.toBotId}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))}
                {messages.every((message) => message.type !== 'message') && (
                  <p className="py-4 text-sm text-muted-foreground">暂无普通消息。</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  )
}
