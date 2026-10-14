'use client'

import { ThreadListRowContent, threadListRowClassName, threadListTriggerClassName } from '@kklyeenook/ui/assistant-ui/thread-list-row'

import { BotSidebar } from '@/renderer/src/features/bots/bot-sidebar'

import { useWorkspaces } from '@/renderer/src/features/workspaces/WorkspaceProvider'

import { Button } from '@/renderer/src/components/ui/button'
import { Input } from '@/renderer/src/components/ui/input'
import { useSidebar } from '@/renderer/src/components/ui/sidebar'
import { TooltipIconButton } from './tooltip-icon-button'
import { cn } from '@/renderer/src/lib/utils'
import {
  isActiveRunStatus,
  useAgentRunOverview,
} from '@/renderer/src/features/runs/AgentRunOverviewProvider'
import {
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react'
import {
  ArchiveIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from 'react'

export const ThreadList: FC = () => <BotSidebar />
export const ThreadListRoot: FC<ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>> = ({
  className,
  ...props
}) => {
  return (
    <ThreadListPrimitive.Root
      data-slot="aui_thread-list-root"
      className={cn('flex flex-col gap-1', className)}
      {...props}
    />
  )
}

export const ThreadListNew = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => {
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile

  return (
    <ThreadListPrimitive.New
      render={
        collapsed ? (
          <TooltipIconButton
            ref={ref}
            tooltip="新会话"
            data-slot="aui_thread-list-new"
            className={cn(
              'mx-auto size-8 justify-center rounded-lg p-0',
              'text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0',
              className,
            )}
            {...props}
          />
        ) : (
          <Button
            ref={ref}
            variant="ghost"
            data-slot="aui_thread-list-new"
            className={cn(
              'h-10 justify-start gap-2 rounded-md px-2 text-sm font-normal',
              'text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0',
              className,
            )}
            {...props}
          />
        )
      }
    >
      {collapsed ? (
        <PlusIcon data-slot="aui_thread-list-new-icon" className="size-3.5" strokeWidth={1.5} />
      ) : (
        (children ?? (
          <>
            <PlusIcon
              data-slot="aui_thread-list-new-icon"
              className="size-3.5 shrink-0"
              strokeWidth={1.5}
            />
            <span
              data-slot="aui_thread-list-new-label"
              className={cn('whitespace-nowrap', labelClassName)}
            >
              新会话
            </span>
          </>
        ))
      )}
    </ThreadListPrimitive.New>
  )
})

ThreadListNew.displayName = 'ThreadListNew'

export const ThreadListItem: FC = () => {
  const { isMobile } = useSidebar()
  const runtimeIsRunning = useAuiState((s) => s.threadListItem.isRunning)
  const sessionId = useAuiState((s) => s.threadListItem.remoteId)
  const { conversations, workspaces, setActiveWorkspaceId } = useWorkspaces()
  const session = conversations.find((item) => item.id === sessionId)
  const updatedAt = session?.updatedAt
  const overview = useAgentRunOverview(sessionId)
  const isWaiting = overview?.status === 'waiting'
  const isRunning = overview ? isActiveRunStatus(overview.status) && !isWaiting : runtimeIsRunning
  const [isRenaming, setIsRenaming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (isRenaming || !restoreFocusRef.current) return
    restoreFocusRef.current = false
    triggerRef.current?.focus()
  }, [isRenaming])

  return (
    <ThreadListItemPrimitive.Root
      data-slot="aui_thread-list-item"
      className={cn(threadListRowClassName, isMobile ? 'mb-1 h-10' : 'mb-1 h-8')}
    >
      {isRenaming ? (
        <ThreadListItemRename
          onDone={(restoreFocus) => {
            restoreFocusRef.current = restoreFocus
            setIsRenaming(false)
          }}
        />
      ) : (
        <>
          <ThreadListItemPrimitive.Trigger
            ref={triggerRef}
            data-slot="aui_thread-list-item-trigger"
            className={cn(threadListTriggerClassName, isMobile && 'pe-10', 'justify-start text-left')}
            onClick={() => {
              const workspaceId = session?.workspaceId
              setActiveWorkspaceId(
                workspaceId && workspaces.some((workspace) => workspace.id === workspaceId)
                  ? workspaceId
                  : null,
              )
            }}
          >
            <ThreadListRowContent title={<ThreadListItemPrimitive.Title fallback="新对话" />} running={isRunning || isWaiting} updatedAt={updatedAt} />
          </ThreadListItemPrimitive.Trigger>
          <ThreadListItemMore isMobile={isMobile} onRename={() => setIsRenaming(true)} />
        </>
      )}
    </ThreadListItemPrimitive.Root>
  )
}

const ThreadListItemRename: FC<{ onDone: (restoreFocus: boolean) => void }> = ({ onDone }) => {
  const aui = useAui()
  const title = useAuiState((s) => s.threadListItem.title) ?? ''
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)
  const focusAfterErrorRef = useRef(false)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    if (!saving && error && focusAfterErrorRef.current) {
      focusAfterErrorRef.current = false
      inputRef.current?.focus()
    }
  }, [saving, error])

  const commit = (restoreFocus: boolean) => {
    if (settledRef.current) return
    settledRef.current = true

    const next = value.trim()
    if (!next || next === title) {
      onDone(restoreFocus)
      return
    }

    setSaving(true)
    setError('')

    // Deferred so a synchronous throw lands on the rejection path too.
    Promise.resolve()
      .then(() => aui.threadListItem.rename(next))
      .then(
        () => onDone(restoreFocus),
        (error) => {
          settledRef.current = false
          focusAfterErrorRef.current = restoreFocus
          setSaving(false)
          setError(error instanceof Error ? error.message : '重命名失败')
        },
      )
  }

  const cancel = () => {
    if (settledRef.current) return
    settledRef.current = true
    onDone(true)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
      <Input
        ref={inputRef}
        autoFocus
        disabled={saving}
        data-slot="aui_thread-list-item-rename"
        aria-label="Rename thread"
        aria-invalid={!!error}
        title={error || undefined}
        value={value}
        className={cn(
          'h-7 min-w-0 flex-1 border-border bg-transparent ps-2.5 pe-2 text-sm text-foreground placeholder:text-faint-foreground focus-visible:border-ring focus-visible:ring-0',
          error && 'border-destructive focus-visible:border-destructive',
        )}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
      />
      {saving && (
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-brand" aria-label="Saving name" />
      )}
      {error && (
        <>
          <CircleAlertIcon className="size-4 shrink-0 text-destructive" aria-label={error} title={error} />
          <span role="alert" className="sr-only">{error}</span>
        </>
      )}
    </div>
  )
}

const ThreadListItemMore: FC<{ onRename: () => void; isMobile: boolean }> = ({
  onRename,
  isMobile,
}) => {
  const aui = useAui()
  const [open, setOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'archive' | 'delete'>()
  const [error, setError] = useState('')
  const runAction = async (action: 'archive' | 'delete') => {
    if (pendingAction) return
    setPendingAction(action)
    setError('')
    try {
      if (action === 'archive') await aui.threadListItem.archive()
      else await aui.threadListItem.delete()
      setOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败')
    } finally {
      setPendingAction(undefined)
    }
  }

  return (
    <ThreadListItemMorePrimitive.Root
      sharedFocusGroup
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pendingAction || nextOpen) setOpen(nextOpen)
      }}
    >
      <ThreadListItemMorePrimitive.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            data-slot="aui_thread-list-item-more"
            className={cn(
              'pointer-events-none absolute end-1 top-1/2 size-6 -translate-y-1/2 rounded-md p-0 text-faint-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-has-focus-visible:pointer-events-auto group-has-focus-visible:opacity-100 hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0 data-[state=open]:pointer-events-auto data-[state=open]:bg-selected data-[state=open]:text-foreground data-[state=open]:opacity-100 data-[state=open]:hover:bg-selected',
              isMobile && 'pointer-events-auto size-8 opacity-100',
            )}
          />
        }
      >
        <MoreHorizontalIcon className="size-3.5" strokeWidth={1.5} />
        <span className="sr-only">More options</span>
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        side="right"
        align="start"
        sideOffset={6}
        data-slot="aui_thread-list-item-more-content"
        className="material-raised data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-36 overflow-hidden rounded-xl p-1.5"
      >
        <ThreadListItemMorePrimitive.Item
          data-slot="aui_thread-list-item-more-item"
          disabled={pendingAction !== undefined}
          className="text-foreground hover:bg-hover focus:bg-hover active:bg-active data-highlighted:bg-hover transition-colors flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none select-none disabled:pointer-events-none disabled:opacity-50"
          onSelect={() => {
            setOpen(false)
            onRename()
          }}
        >
          <PencilIcon className="size-4 shrink-0 text-brand" />
          <span className="min-w-0 flex-1 font-medium">重命名</span>
        </ThreadListItemMorePrimitive.Item>
        <ThreadListItemMorePrimitive.Item
          data-slot="aui_thread-list-item-more-item"
          disabled={pendingAction !== undefined}
          className="text-foreground hover:bg-hover focus:bg-hover active:bg-active data-highlighted:bg-hover transition-colors flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none select-none disabled:pointer-events-none disabled:opacity-50"
          onSelect={(event) => {
            event.preventDefault()
            void runAction('archive')
          }}
        >
          <ArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 font-medium">归档</span>
          {pendingAction === 'archive' && (
            <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-brand" />
          )}
        </ThreadListItemMorePrimitive.Item>
        <ThreadListItemMorePrimitive.Item
          data-slot="aui_thread-list-item-more-item"
          disabled={pendingAction !== undefined}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive active:bg-destructive/15 data-highlighted:bg-destructive/10 data-highlighted:text-destructive transition-colors flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none select-none disabled:pointer-events-none disabled:opacity-50"
          onSelect={(event) => {
            event.preventDefault()
            void runAction('delete')
          }}
        >
          <Trash2Icon className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 font-medium">删除</span>
          {pendingAction === 'delete' && (
            <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-destructive" />
          )}
        </ThreadListItemMorePrimitive.Item>
        {error && <p role="alert" className="px-2.5 py-2 text-xs text-destructive">{error}</p>}
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  )
}

