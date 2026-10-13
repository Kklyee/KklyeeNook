import { createContext, useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  FolderIcon,
  MessageCircleIcon,
  PlusIcon,
  Settings2Icon,
} from 'lucide-react'
import type {
  RemoteConversationSnapshot,
  RemoteConversationSummary,
} from '@kklyeenook/shared/remote/index'
import { BOT_STATE_LABELS } from '@kklyeenook/shared/bot/bot-state'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { Dialog, DialogContent, DialogTitle } from '@kklyeenook/ui/components/dialog'
import { Button } from '@kklyeenook/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kklyeenook/ui/components/collapsible'
import { ThreadListRow } from '@kklyeenook/ui/assistant-ui/thread-list-row'
import { api, cacheConversation } from './api'
import { useBots } from './bot-provider'

export const NavigationContext = createContext<() => void>(() => undefined)

export function Navigation({
  open,
  onOpenChange,
  route,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  route: string
}) {
  const { bots, options, error: botError } = useBots()
  const [threads, setThreads] = useState<RemoteConversationSummary[]>([])
  const [error, setError] = useState('')
  const [showBots, setShowBots] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = route.split('/')[2]
  const bot = bots.find((bot) => bot.id === id)
  const coder = bot?.kind === 'coding' && !showBots
  useEffect(() => {
    setShowBots(false)
  }, [id])
  useEffect(() => {
    if (!open || !bot) return
    let active = true
    api<RemoteConversationSummary[]>('/bots/' + bot.id + '/conversations')
      .then((value) => {
        if (active) {
          setThreads(value)
          setError('')
        }
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [open, bot?.id, route])
  const select = (path: string) => {
    location.hash = path
    onOpenChange(false)
  }
  const create = async (workspaceId: string | null) => {
    if (!bot || busy) return
    setBusy(true)
    setError('')
    try {
      const snapshot = await api<RemoteConversationSnapshot>(
        '/bots/' + bot.id + '/conversations',
        'POST',
        { workspaceId, requestId: crypto.randomUUID() },
      )
      cacheConversation(snapshot.id, snapshot)
      select('/bots/' + bot.id + '/conversations/' + snapshot.id)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const rows = (workspaceId: string | null, includeWorkspaces = false) =>
    threads
      .filter(
        (thread) =>
          thread.id !== bot?.mainThreadId &&
          !thread.archived &&
          (includeWorkspaces || thread.projectId === (workspaceId ?? '')),
      )
      .map((thread) => (
        <ThreadListRow
          key={thread.id}
          title={thread.title}
          running={thread.status === 'running'}
          active={route.endsWith('/' + thread.id)}
          updatedAt={thread.updatedAt}
          onClick={() => select('/bots/' + bot!.id + '/conversations/' + thread.id)}
        />
      ))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        initialFocus={false}
        className="mobile-navigation top-0 left-0 translate-x-0 translate-y-0"
        showCloseButton={false}
      >
        <div className="flex items-center gap-2">
          {coder && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="返回 My Bots"
              onClick={() => setShowBots(true)}
            >
              <ArrowLeftIcon />
            </Button>
          )}
          <DialogTitle className="flex-1 text-lg">{coder ? bot.name : 'Chat'}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Create Bot"
            onClick={() => select('/bots/new')}
          >
            <PlusIcon />
          </Button>
        </div>
        <nav
          className="min-h-0 flex-1 space-y-2 overflow-y-auto"
          aria-label="Bots and conversations"
        >
          {(error || botError) && (
            <p role="alert" className="text-sm text-destructive">
              {error || botError}
            </p>
          )}
          {coder ? (
            <>
              <Button
                variant="ghost"
                className="mb-4 h-14 w-full justify-start gap-3"
                onClick={() => select('/bots/' + bot.id)}
              >
                <MessageCircleIcon />
                主会话
              </Button>
              <p className="px-2 text-xs text-muted-foreground">WORKSPACES</p>
              {options.workspaces
                .filter((workspace) => bot.workspaceIds.includes(workspace.id))
                .map((workspace) => (
                  <Collapsible key={workspace.id} defaultOpen>
                    <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 px-2 text-sm">
                      <FolderIcon className="size-4" />
                      <span className="flex-1 text-left">{workspace.displayName}</span>
                      <ChevronDownIcon className="size-3" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="ml-3">
                      {rows(workspace.id)}
                      <Button
                        variant="ghost"
                        className="min-h-11 w-full justify-start text-xs"
                        disabled={busy || workspace.status !== 'attached'}
                        onClick={() => void create(workspace.id)}
                      >
                        <PlusIcon />
                        新建开发会话
                      </Button>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              {rows(null)}
            </>
          ) : (
            <>
              <p className="px-2 text-xs text-muted-foreground">MY BOTS</p>
              {bots.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  className="h-auto min-h-18 w-full justify-start gap-3 rounded-xl px-3 py-3"
                  style={
                    item.id === bot?.id
                      ? {
                          background:
                            'color-mix(in srgb, ' + item.avatar.accentColor + ' 12%, transparent)',
                        }
                      : undefined
                  }
                  onClick={() => select('/bots/' + item.id)}
                >
                  <BotAvatar avatar={item.avatar} name={item.name} state={item.state} size={42} />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.role} · {BOT_STATE_LABELS[item.state]}
                    </span>
                  </span>
                </Button>
              ))}
              {bot && (
                <Collapsible defaultOpen className="mt-5 border-t border-border pt-4">
                  <CollapsibleTrigger className="min-h-11 px-2 text-xs text-muted-foreground">
                    OTHER CONVERSATIONS
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {rows(null, true)}
                    <Button
                      variant="ghost"
                      className="min-h-11 w-full justify-start text-xs"
                      disabled={busy}
                      onClick={() => void create(null)}
                    >
                      <PlusIcon />
                      新建会话
                    </Button>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
          {bot && threads.some((thread) => thread.archived) && (
            <details>
              <summary className="cursor-pointer py-3 text-xs text-muted-foreground">
                已归档
              </summary>
              {threads
                .filter((thread) => thread.archived)
                .map((thread) => (
                  <div key={thread.id} className="flex items-center">
                    <Button
                      variant="ghost"
                      className="min-w-0 flex-1 justify-start truncate text-xs"
                      onClick={() => select('/bots/' + bot.id + '/conversations/' + thread.id)}
                    >
                      {thread.title}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        void api('/conversations/' + thread.id + '/archive', 'POST', {
                          archived: false,
                        })
                          .then(() =>
                            setThreads((threads) =>
                              threads.map((item) =>
                                item.id === thread.id ? { ...item, archived: false } : item,
                              ),
                            ),
                          )
                          .catch((error) => setError(error.message))
                      }}
                    >
                      恢复
                    </Button>
                  </div>
                ))}
            </details>
          )}
        </nav>
        <Button
          variant="ghost"
          className="min-h-11 justify-start gap-2 border-t border-border"
          onClick={() => select(bot ? '/bots/' + bot.id + '/edit' : '/')}
        >
          <Settings2Icon />
          Manage Bots
        </Button>
      </DialogContent>
    </Dialog>
  )
}
