import { useState } from 'react'
import { ThreadListPrimitive, useAuiState } from '@assistant-ui/react'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  MessageCircleIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
} from 'lucide-react'
import type { BotSummary } from '@kklyeenook/shared/bot/bot'
import type { WorkspaceAttachResult } from '@kklyeenook/shared/workspace/workspace'
import { BOT_STATE_LABELS } from '@kklyeenook/shared/bot/bot-state'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { threadListRowClassName } from '@kklyeenook/ui/assistant-ui/thread-list-row'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog'
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
  const { state, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const [view, setView] = useState<'bots' | 'threads'>('bots')
  const bot = snapshot.bots.find((bot) => bot.id === snapshot.selectedBotId)
  return (
    <ThreadListRoot className="min-h-full gap-0.5">
      {view === 'bots' || !bot ? (
        <MyBotsList
          bots={snapshot.bots}
          selectedBotId={snapshot.selectedBotId}
          collapsed={collapsed}
          onCreate={() => store.editBot('new')}
          onSelect={(id) => {
            setView('threads')
            void store.selectBot(id).catch(() => undefined)
          }}
        />
      ) : (
        <BotThreads key={bot.id} bot={bot} collapsed={collapsed} onBack={() => setView('bots')} />
      )}
    </ThreadListRoot>
  )
}

function MyBotsList({
  bots,
  selectedBotId,
  collapsed,
  onSelect,
  onCreate,
}: {
  bots: readonly BotSummary[]
  selectedBotId?: string
  collapsed: boolean
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  return (
    <div data-view="my-bots" className="flex flex-col gap-0.5">
      <header
        className={
          collapsed ? 'flex h-11 items-center justify-center' : 'flex h-11 items-center gap-1 px-2'
        }
      >
        {!collapsed && <h1 className="min-w-0 flex-1 text-[13px] font-medium">My Bots</h1>}
        <Button
          variant="ghost"
          size={collapsed ? 'icon-sm' : 'sm'}
          className="h-7 gap-1 px-1.5 text-xs font-normal text-muted-foreground"
          aria-label="创建 Bot"
          title="创建 Bot"
          onClick={onCreate}
        >
          <PlusIcon className="size-3.5" />
          {!collapsed && '创建 Bot'}
        </Button>
      </header>
      {bots.map((bot) => (
        <Button
          key={bot.id}
          variant="ghost"
          title={collapsed ? bot.name : undefined}
          aria-label={bot.name}
          aria-pressed={bot.id === selectedBotId}
          data-active={bot.id === selectedBotId || undefined}
          className={[
            threadListRowClassName,
            collapsed ? 'h-12 justify-center px-0' : 'h-14 justify-start gap-2 px-2 text-left',
            'font-normal',
          ].join(' ')}
          onClick={() => onSelect(bot.id)}
        >
          <BotAvatar
            avatar={bot.avatar}
            name={bot.name}
            state={bot.state}
            size={collapsed ? 30 : 36}
          />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-medium">{bot.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {bot.state === 'idle' ? bot.role : BOT_STATE_LABELS[bot.state]}
                </span>
              </span>
              <ChevronRightIcon className="size-3 text-muted-foreground" />
            </>
          )}
        </Button>
      ))}
    </div>
  )
}

function BotThreads({
  bot,
  collapsed,
  onBack,
}: {
  bot: BotSummary
  collapsed: boolean
  onBack: () => void
}) {
  const store = useChatStore()
  const snapshot = useChatRuntimeSnapshot()
  const { workspaces, reload } = useWorkspaces()
  const items = useAuiState((state) => state.threads.threadItems)
  const ids = useAuiState((state) => state.threads.threadIds)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [pendingWorkspace, setPendingWorkspace] = useState<WorkspaceAttachResult>()
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
        store.editBot(bot.id)
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
      store.editBot(bot.id)
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
        !thread?.archived &&
        thread?.botId === bot.id &&
        thread.id !== bot.mainThreadId &&
        (!query || thread.title?.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    )
  const renderRows = (workspaceId: string | null, includeWorkspaces = false) =>
    rows
      .filter(({ thread }) => includeWorkspaces || (thread?.workspaceId ?? null) === workspaceId)
      .map(({ id, index }) => (
        <ThreadListPrimitive.ItemByIndex key={id} index={index} components={{ ThreadListItem }} />
      ))
  return (
    <div data-view="bot-threads" className="flex flex-col gap-0.5">
      {(error || snapshot.current.error) && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error || snapshot.current.error}
        </p>
      )}
      <header
        className={
          collapsed ? 'flex flex-col items-center gap-1 py-1' : 'flex h-11 items-center gap-1 px-1'
        }
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="返回 My Bots"
          title="返回 My Bots"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          className={
            collapsed
              ? 'h-9 min-w-0 justify-center px-0'
              : 'h-9 min-w-0 flex-1 justify-start gap-2 px-1'
          }
          aria-label={bot.name + ' 设置'}
          title="Bot 设置"
          onClick={() => store.editBot(bot.id)}
        >
          <BotAvatar avatar={bot.avatar} name={bot.name} state={bot.state} size={28} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">
                {bot.name}
              </span>
              <Settings2Icon className="size-3.5 text-muted-foreground" />
            </>
          )}
        </Button>
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="新建会话"
            onClick={() => void run(() => store.createThread({ botId: bot.id }))}
          >
            <PlusIcon className="size-4" />
          </Button>
        )}
      </header>
      {!collapsed && (
        <>
          <Button
            variant="ghost"
            className={
              threadListRowClassName + ' h-10 justify-start gap-2 px-2 text-left text-[13px] font-normal'
            }
            aria-pressed={snapshot.selectedThreadId === bot.mainThreadId}
            data-active={snapshot.selectedThreadId === bot.mainThreadId || undefined}
            onClick={() => void run(() => store.selectBot(bot.id))}
          >
            <MessageCircleIcon className="size-4" />
            <span>聊天</span>
          </Button>
          {bot.kind === 'coding' ? (
            <>
              <div className="mt-5 flex h-7 items-center justify-between px-2 text-[11px] text-muted-foreground">
                <span>WORKSPACES</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="添加 Workspace"
                  onClick={() => void pickWorkspace()}
                >
                  <PlusIcon className="size-3" />
                </Button>
              </div>
              <div className="flex items-center gap-1 px-2">
                <SearchIcon className="size-3 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索会话…"
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
                  >
                    <div className="flex items-center gap-0.5">
                      <CollapsibleTrigger aria-label={'展开或折叠 ' + workspace.displayName} className="group/workspace flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground">
                        <FolderIcon className="size-4 group-data-[panel-open]/workspace:hidden" />
                        <FolderOpenIcon className="hidden size-4 text-brand group-data-[panel-open]/workspace:block" />
                        <span className="flex-1 truncate">{workspace.displayName}</span>
                      </CollapsibleTrigger>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={'为 ' + workspace.displayName + ' 新建会话'}
                        disabled={
                          !bot.workspaceIds.includes(workspace.id) ||
                          workspace.status !== 'attached'
                        }
                        onClick={() =>
                          void run(() =>
                            store.createThread({ botId: bot.id, workspaceId: workspace.id }),
                          )
                        }
                      >
                        <PlusIcon className="size-3" />
                      </Button>
                    </div>
                    <CollapsibleContent className="flex flex-col">
                      {renderRows(workspace.id)}
                      {!rows.some(({ thread }) => thread?.workspaceId === workspace.id) && (
                        <p className="px-8 py-1 text-xs text-muted-foreground">暂无会话</p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              {renderRows(null)}
              {!bot.workspaceIds.length && (
                <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                  在 Bot 设置中授权 Workspace，然后创建开发会话。
                </p>
              )}
            </>
          ) : (
            renderRows(null, true)
          )}
        </>
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
    </div>
  )
}
