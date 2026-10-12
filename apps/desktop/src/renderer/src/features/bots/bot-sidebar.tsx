import { useEffect, useState } from 'react'
import { ThreadListPrimitive, useAuiState } from '@assistant-ui/react'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  MessageCircleIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
} from 'lucide-react'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { BOT_STATE_LABELS } from '@kklyeenook/shared/bot/bot-state'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { threadListRowClassName } from '@kklyeenook/ui/assistant-ui/thread-list-row'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog'
import type { WorkspaceAttachResult } from '@kklyeenook/shared/workspace/workspace'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import {
  ThreadListItem,
  ThreadListRoot,
} from '../../components/assistant-ui/elements/thread-list.aui'
import { useSidebar } from '../../components/ui/sidebar'
import { useChatRuntimeSnapshot, useChatStore } from '../chat/runtime/chat-runtime'
import { useWorkspaces } from '../workspaces/WorkspaceProvider'

export function BotSidebar() {
  const store = useChatStore()
  const snapshot = useChatRuntimeSnapshot()
  const { workspaces, reload } = useWorkspaces()
  const { state, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const items = useAuiState((state) => state.threads.threadItems)
  const ids = useAuiState((state) => state.threads.threadIds)
  const [showBots, setShowBots] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [botMenuOpen, setBotMenuOpen] = useState(false)
  const [pendingWorkspace, setPendingWorkspace] = useState<WorkspaceAttachResult>()
  const bot = snapshot.bots.find((bot) => bot.id === snapshot.selectedBotId)
  const coderView = bot?.kind === 'coding' && !showBots && !collapsed
  useEffect(() => {
    setShowBots(false)
    setQuery('')
  }, [snapshot.selectedBotId])
  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败')
    }
  }
  const pickWorkspace = () =>
    run(async () => {
      const result = await window.api.workspaces.pick()
      if (result?.candidates) setPendingWorkspace(result)
      else if (result?.workspace) {
        await reload()
        store.editBot(bot?.id)
      }
    })
  const attachWorkspace = (relinkId?: string) =>
    run(async () => {
      if (!pendingWorkspace?.path) return
      await window.api.workspaces.attach({
        path: pendingWorkspace.path,
        relinkId,
        createNew: !relinkId,
      })
      setPendingWorkspace(undefined)
      await reload()
      store.editBot(bot?.id)
    })
  const rows = ids
    .map((id, index) => ({
      id,
      index,
      thread: snapshot.threads.find(
        (thread) => thread.id === items.find((item) => item.id === id)?.remoteId,
      ),
    }))
    .filter(
      ({ thread }) =>
        thread?.botId === bot?.id &&
        thread?.id !== bot?.mainThreadId &&
        (!query || thread?.title?.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    )
  const renderRows = (workspaceId: string | null, includeWorkspaces = false) =>
    rows
      .filter(({ thread }) => includeWorkspaces || (thread?.workspaceId ?? null) === workspaceId)
      .map(({ id, index }) => (
        <ThreadListPrimitive.ItemByIndex key={id} index={index} components={{ ThreadListItem }} />
      ))
  const archived = snapshot.threads.filter(
    (thread) => thread.botId === bot?.id && thread.archived && thread.id !== bot?.mainThreadId,
  )
  return (
    <ThreadListRoot className="min-h-full gap-1">
      {(error || snapshot.current.error) && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error || snapshot.current.error}
        </p>
      )}
      {(
        <header className="flex min-h-12 items-center gap-2 px-2">
          {coderView ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="返回 My Bots"
                onClick={() => setShowBots(true)}
              >
                <ArrowLeftIcon />
              </Button>
              <Popover open={botMenuOpen} onOpenChange={setBotMenuOpen}>
                <PopoverTrigger render={<Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-1" aria-label={`${bot.name} 菜单`} />}>
                  <BotAvatar avatar={bot.avatar} name={bot.name} state={bot.state} size={32} />
                  <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{bot.name}</span><span className="block truncate text-[11px] font-normal text-muted-foreground">{bot.role}</span></span>
                  <ChevronDownIcon className="size-3 text-muted-foreground" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-48">
                  <Button variant="ghost" className="justify-start" onClick={() => { setBotMenuOpen(false); store.editBot(bot.id) }}><Settings2Icon className="size-4" />Bot 设置</Button>
                </PopoverContent>
              </Popover>
            </>
          ) : (
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" className="min-w-0 flex-1 justify-start px-0" aria-label="Bot 菜单" />}>
                {collapsed ? <Settings2Icon /> : <><span className="text-base font-semibold">Chat</span><ChevronDownIcon className="size-3" /></>}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-48"><Button variant="ghost" className="justify-start" onClick={() => store.editBot(bot?.id ?? snapshot.bots[0]?.id ?? 'new')}>Bot 设置</Button></PopoverContent>
            </Popover>
          )}
          {!collapsed && <Button
            variant="ghost"
            size="icon-sm"
            aria-label={coderView ? '新建开发会话' : 'Create Bot'}
            onClick={() =>
              coderView ? void run(() => store.createThread()) : store.editBot('new')
            }
          >
            <PlusIcon />
          </Button>}
        </header>
      )}
      {coderView ? (
        <>
          <Button
            variant="ghost"
            className={`${threadListRowClassName} justify-start gap-2 px-2 text-left text-[13px] font-normal`}
            aria-pressed={snapshot.selectedThreadId === bot.mainThreadId}
            data-active={snapshot.selectedThreadId === bot.mainThreadId ? '' : undefined}
            onClick={() => void run(() => store.selectBot(bot.id))}
          >
            <MessageCircleIcon className="size-4" />
            <span>主会话</span>
          </Button>
          <div className="flex items-center justify-between px-2 text-[11px] text-faint-foreground">
            <span>WORKSPACES</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="添加 Workspace"
              onClick={() => void pickWorkspace()}
            >
              <PlusIcon />
            </Button>
          </div>
          <div className="flex items-center gap-2 px-2">
            <SearchIcon className="size-3.5 text-faint-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索开发会话…"
              aria-label="搜索开发会话"
              className="h-7 border-0 bg-transparent text-xs"
            />
          </div>
          {workspaces
            .filter(
              (workspace) =>
                bot.workspaceIds.includes(workspace.id) ||
                rows.some(({ thread }) => thread?.workspaceId === workspace.id),
            )
            .map((workspace) => (
              <Collapsible
                key={workspace.id}
                defaultOpen={workspace.id === snapshot.current.metadata?.workspaceId}
                className="space-y-1"
              >
                <div className="flex items-center gap-1">
                <CollapsibleTrigger className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-hover">
                  <FolderIcon className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{workspace.displayName}</span>
                  <ChevronDownIcon className="size-3" />
                </CollapsibleTrigger>
                <Button variant="ghost" size="icon-xs" aria-label={`为 ${workspace.displayName} 新建会话`} disabled={!bot.workspaceIds.includes(workspace.id) || workspace.status !== 'attached'} onClick={() => void run(() => store.createThread({ botId: bot.id, workspaceId: workspace.id }))}><PlusIcon className="size-3" /></Button>
                </div>
                <CollapsibleContent className="ml-3 flex flex-col gap-0.5">
                  {renderRows(workspace.id)}
                  {!rows.some(({ thread }) => thread?.workspaceId === workspace.id) && <p className="px-5 py-1 text-xs text-muted-foreground">暂无会话</p>}
                </CollapsibleContent>
              </Collapsible>
            ))}
          {rows.some(({ thread }) => !thread?.workspaceId) && (
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="px-2 py-2 text-xs text-muted-foreground">
                其他会话
              </CollapsibleTrigger>
              <CollapsibleContent>{renderRows(null)}</CollapsibleContent>
            </Collapsible>
          )}
          {!bot.workspaceIds.length && (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
              在 Coder 设置中授权 Workspace，然后创建开发会话。
            </p>
          )}
        </>
      ) : (
        <>
          {!collapsed && (
            <p className="px-2 py-2 text-[11px] font-medium tracking-wide text-faint-foreground">
              MY BOTS
            </p>
          )}
          {snapshot.bots.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              title={collapsed ? item.name : undefined}
              aria-label={item.name}
              aria-pressed={item.id === snapshot.selectedBotId}
              className={
                collapsed
                  ? 'h-12 justify-center rounded-xl px-0'
                  : 'h-auto min-h-17 justify-start gap-3 rounded-xl px-3 py-3 text-left'
              }
              style={
                item.id === snapshot.selectedBotId
                  ? {
                      background: `color-mix(in srgb, ${item.avatar.accentColor} 12%, transparent)`,
                    }
                  : undefined
              }
              onClick={() => {
                setShowBots(false)
                void run(() => store.selectBot(item.id))
              }}
            >
              <BotAvatar
                avatar={item.avatar}
                name={item.name}
                state={item.state}
                size={collapsed ? 30 : 42}
              />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {item.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.state === 'idle' ? item.role : BOT_STATE_LABELS[item.state]}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-3.5 text-faint-foreground" />
                </>
              )}
            </Button>
          ))}
          {!collapsed && bot && (
            <div className="mt-2">
              <div className="flex flex-col gap-1">
                {renderRows(null, true)}
                <Button
                  variant="ghost"
                  className="justify-start text-xs font-normal"
                  onClick={() => void run(() => store.createThread({ botId: bot.id }))}
                >
                  <PlusIcon />
                  新建会话
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {!collapsed && archived.length > 0 && (
        <details className="mt-3 px-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            已归档 · {archived.length}
          </summary>
          <div className="mt-2 space-y-1">
            {archived.map((thread) => (
              <div key={thread.id} className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start truncate text-xs"
                  onClick={() => void run(() => store.switchToThread(thread.id))}
                >
                  {thread.title}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void run(() => store.archive(thread.id, false))}
                >
                  恢复
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={!!pendingWorkspace}
        onOpenChange={(open) => {
          if (!open) setPendingWorkspace(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关联 Workspace</DialogTitle>
            <DialogDescription>
              将目录重新关联到已有项目，或创建一个新的 Workspace。
            </DialogDescription>
          </DialogHeader>
          {pendingWorkspace?.candidates?.map((workspace) => (
            <Button
              key={workspace.id}
              variant="ghost"
              className="justify-start"
              onClick={() => void attachWorkspace(workspace.id)}
            >
              {workspace.displayName}
            </Button>
          ))}
          <Button onClick={() => void attachWorkspace()}>创建新的 Workspace</Button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </ThreadListRoot>
  )
}
