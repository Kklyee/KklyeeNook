import { useEffect, useState } from 'react'
import { ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useChatStore, useChatRuntimeSnapshot } from '../chat/runtime/chat-runtime'
import { useWorkspaces } from '../workspaces/WorkspaceProvider'

export function ConversationSettings() {
  const store = useChatStore()
  const { threads, bots } = useChatRuntimeSnapshot()
  const { workspaces } = useWorkspaces()
  const [filter, setFilter] = useState<'archived' | 'active' | 'all'>('archived')
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void store.reloadThreads().catch((error) => {
      if (active) setError(error instanceof Error ? error.message : '会话加载失败')
    })
    return () => {
      active = false
    }
  }, [store])
  const name = (botId?: string | null) => bots.find((bot) => bot.id === botId)?.name ?? '未关联 Bot'
  const visible = threads.filter(
    (thread) =>
      (filter === 'all' || Boolean(thread.archived) === (filter === 'archived')) &&
      (thread.title + ' ' + name(thread.botId)).toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" aria-label="会话状态">
          {(['archived', 'active', 'all'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              aria-pressed={filter === value}
              className="h-8 text-xs aria-pressed:bg-selected"
              onClick={() => setFilter(value)}
            >
              {{ archived: '已归档', active: '未归档', all: '全部' }[value]}
            </Button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索会话或 Bot"
          placeholder="搜索会话或 Bot…"
          className="h-8 min-w-40 flex-1 text-xs"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="divide-y divide-border/60">
        {visible.map((thread) => {
          const main = bots.some((bot) => bot.mainThreadId === thread.id)
          const workspace = workspaces.find((workspace) => workspace.id === thread.workspaceId)
          return (
            <div key={thread.id} className="flex min-h-14 items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{thread.title || '新会话'}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {name(thread.botId)}
                  {workspace ? ' · ' + workspace.displayName : ''}
                  {main ? ' · 主会话' : ''}
                </span>
              </span>
              {!main && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending !== undefined}
                  className="shrink-0 text-xs"
                  onClick={async () => {
                    setPending(thread.id)
                    setError('')
                    try {
                      await store.archive(thread.id, !thread.archived)
                    } catch (error) {
                      setError(error instanceof Error ? error.message : '操作失败')
                    } finally {
                      setPending(undefined)
                    }
                  }}
                >
                  {thread.archived ? (
                    <ArchiveRestoreIcon className="size-3.5" />
                  ) : (
                    <ArchiveIcon className="size-3.5" />
                  )}
                  {thread.archived ? '恢复' : '归档'}
                </Button>
              )}
            </div>
          )
        })}
        {!visible.length && <p className="py-6 text-sm text-muted-foreground">没有匹配的会话</p>}
      </div>
    </div>
  )
}
