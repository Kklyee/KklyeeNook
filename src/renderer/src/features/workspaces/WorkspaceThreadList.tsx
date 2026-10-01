import { useState } from 'react'
import { ThreadListPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import {
  ArchiveIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageCirclePlusIcon,
  MoreHorizontalIcon,
  SearchIcon,
} from 'lucide-react'
import type { WorkspaceAttachResult } from '@/shared/workspace/workspace'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { useSidebar } from '../../components/ui/sidebar'
import { TooltipIconButton } from '../../components/assistant-ui/elements/tooltip-icon-button'
import {
  ThreadListRoot,
  ThreadListNew,
  ThreadListItem,
} from '../../components/assistant-ui/elements/thread-list.aui'
import { cn } from '../../lib/utils'
import { useWorkspaces } from './WorkspaceProvider'

export function WorkspaceThreadList() {
  const { workspaces, reload, setDraftWorkspaceId } = useWorkspaces()
  const [pending, setPending] = useState<WorkspaceAttachResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const pick = async () => {
    try {
      setError(null)
      const result = await window.api.workspaces.pick()
      if (result?.candidates) setPending(result)
      await reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : '添加项目失败')
    }
  }
  const attach = async (relinkId?: string) => {
    if (!pending?.path) return
    try {
      await window.api.workspaces.attach({ path: pending.path, relinkId, createNew: !relinkId })
      setPending(null)
      await reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : '关联失败')
    }
  }
  return (
    <ThreadListRoot className="gap-1.5">
      <ThreadListNew
        onClick={() => setDraftWorkspaceId(null)}
        className={
          collapsed
            ? ''
            : 'mb-3 h-10 justify-center border border-glass-border bg-interactive-selected text-text-strong'
        }
      >
        <MessageCirclePlusIcon className="size-4" />
        <span>新会话</span>
      </ThreadListNew>
      {collapsed ? (
        <TooltipIconButton
          tooltip="添加项目"
          className="mx-auto size-8"
          onClick={() => void pick()}
        >
          <FolderPlusIcon className="size-4" />
        </TooltipIconButton>
      ) : (
        <>
          <div className="flex h-8 items-center gap-1 px-2 text-xs text-text-muted">
            <span className="flex-1">工作区</span>
            <TooltipIconButton
              tooltip="搜索会话"
              aria-pressed={searchOpen}
              onClick={() => {
                setSearchOpen(!searchOpen)
                setQuery('')
              }}
            >
              <SearchIcon className="size-3.5" />
            </TooltipIconButton>
            <TooltipIconButton tooltip="添加项目" onClick={() => void pick()}>
              <FolderPlusIcon className="size-3.5" />
            </TooltipIconButton>
          </div>
          {searchOpen && (
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目或会话…"
              aria-label="搜索项目或会话"
              className="mb-1 h-8 text-xs"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setSearchOpen(false)
                  setQuery('')
                }
              }}
            />
          )}
          {workspaces.map((workspace) => (
            <WorkspaceThreadGroup
              key={workspace.id}
              workspaceId={workspace.id}
              label={workspace.displayName}
              query={query}
            />
          ))}
          <WorkspaceThreadGroup workspaceId={null} label="未分组" query={query} />
        </>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发现可能存在旧项目</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-muted">选择要关联的旧项目，或将该目录作为新项目添加。</p>
          {pending?.candidates?.map((workspace) => (
            <Button key={workspace.id} variant="outline" onClick={() => void attach(workspace.id)}>
              关联旧项目 · {workspace.displayName}
            </Button>
          ))}
          <Button onClick={() => void attach()}>作为新项目添加</Button>
        </DialogContent>
      </Dialog>
    </ThreadListRoot>
  )
}

function WorkspaceThreadGroup({
  workspaceId,
  label,
  query,
}: {
  workspaceId: string | null
  label: string
  query: string
}) {
  const { conversations, workspaces, draftWorkspaceId, setDraftWorkspaceId, reload } =
    useWorkspaces()
  const aui = useAui()
  const ids = useAuiState((s) => s.threads.threadIds)
  const items = useAuiState((s) => s.threads.threadItems)
  const mainId = useAuiState((s) => s.threads.mainThreadId)
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspace = workspaces.find((item) => item.id === workspaceId)
  const visibleWorkspaceId = (id?: string | null) =>
    id && workspaces.some((item) => item.id === id) ? id : null
  const remoteId = items.find((item) => item.id === mainId)?.remoteId
  const activeWorkspaceId = remoteId
    ? visibleWorkspaceId(conversations.find((item) => item.id === remoteId)?.workspaceId)
    : visibleWorkspaceId(draftWorkspaceId)
  const selected = workspaceId === activeWorkspaceId
  const detach = async () => {
    setMenuOpen(false)
    try {
      await window.api.workspaces.detach(workspaceId!)
      if (draftWorkspaceId === workspaceId) setDraftWorkspaceId(null)
      await reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : '移除失败')
    }
  }
  const search = query.trim().toLocaleLowerCase()
  const matchesGroup = label.toLocaleLowerCase().includes(search)
  const indices = ids
    .map((id, index) => ({ index, item: items.find((item) => item.id === id) }))
    .filter(({ item }) => {
      const conversation = conversations.find((conversation) => conversation.id === item?.remoteId)
      return (
        conversation &&
        visibleWorkspaceId(conversation.workspaceId) === workspaceId &&
        (matchesGroup || (item?.title ?? conversation.title ?? '新对话').toLocaleLowerCase().includes(search))
      )
    })
  if (search && !matchesGroup && !indices.length) return null
  const visible = expanded || search ? indices : indices.slice(0, 5)
  return (
    <Collapsible
      open={open || Boolean(search)}
      onOpenChange={setOpen}
      className="flex flex-col gap-0.5"
    >
      <div className="group/workspace flex h-9 items-center gap-0.5 rounded-lg pr-1 text-text-muted hover:bg-interactive-hover has-focus-visible:bg-interactive-hover has-data-popup-open:bg-interactive-hover">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="h-full min-w-0 flex-1 justify-start gap-2 rounded-lg px-2 text-sm font-normal hover:bg-transparent aria-expanded:bg-transparent"
            />
          }
          title={workspace?.rootPath ?? workspace?.lastKnownPath}
        >
          <span className="relative size-4 shrink-0">
            <FolderIcon
              className={cn(
                'absolute size-4 group-hover/workspace:opacity-0 group-focus-within/workspace:opacity-0',
                selected && workspace && 'text-blue-400',
              )}
            />
            <ChevronDownIcon
              className={cn(
                'absolute size-4 opacity-0 group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100',
                !open && !search && '-rotate-90',
              )}
            />
          </span>
          <span className={cn('truncate', selected && 'text-text-strong')}>{label}</span>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center opacity-0 group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100 has-data-popup-open:opacity-100 [@media(hover:none)]:opacity-100">
          {workspace && (
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-text-faint"
                    aria-label={label + '项目选项'}
                  />
                }
              >
                <MoreHorizontalIcon className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-40 gap-0.5 p-1.5"
              >
                <Button
                  variant="ghost"
                  className="justify-start text-xs font-normal"
                  onClick={() => void detach()}
                >
                  <ArchiveIcon className="size-3.5" />
                  移除项目
                </Button>
              </PopoverContent>
            </Popover>
          )}
          <TooltipIconButton
            tooltip="新会话"
            className="size-6"
            onClick={() => {
              setDraftWorkspaceId(workspaceId)
              setOpen(true)
              void aui.threads.switchToNewThread()
            }}
          >
            <MessageCirclePlusIcon className="size-3.5" />
          </TooltipIconButton>
        </div>
      </div>
      <CollapsibleContent className="flex flex-col gap-0.5">
        {visible.map(({ index }) => (
          <ThreadListPrimitive.ItemByIndex
            key={ids[index]}
            index={index}
            components={{ ThreadListItem }}
          />
        ))}
        {!search && indices.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-start pl-8 text-xs font-normal text-text-faint"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起会话' : '展开其余 ' + (indices.length - 5) + ' 个会话'}
          </Button>
        )}
      </CollapsibleContent>
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </Collapsible>
  )
}
