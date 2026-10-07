'use client'

import { ThreadListRowContent, threadListRowClassName, threadListTriggerClassName } from '@kklyeenook/ui/assistant-ui/thread-list-row'

import { WorkspaceThreadList } from '@/renderer/src/features/workspaces/WorkspaceThreadList'

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
import { MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from 'react'

export const ThreadList: FC = () => <WorkspaceThreadList />
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
      className={threadListRowClassName}
    >
      {isRenaming ? (
        <ThreadListItemRename
          onDone={(restoreFocus) => {
            restoreFocusRef.current = restoreFocus
            setIsRenaming(false)
          }}
        />
      ) : (
        <ThreadListItemPrimitive.Trigger
          ref={triggerRef}
          data-slot="aui_thread-list-item-trigger"
          className={threadListTriggerClassName}
          onClick={() => {
            const workspaceId = session?.workspaceId
            setActiveWorkspaceId(
              workspaceId && workspaces.some((workspace) => workspace.id === workspaceId)
                ? workspaceId
                : null,
            )
          }}
        >
          <ThreadListRowContent title={<ThreadListItemPrimitive.Title fallback="新对话" />} running={isRunning} waiting={isWaiting} updatedAt={updatedAt} />
        </ThreadListItemPrimitive.Trigger>
      )}
      <ThreadListItemMore onRename={() => setIsRenaming(true)} />
    </ThreadListItemPrimitive.Root>
  )
}

const ThreadListItemRename: FC<{ onDone: (restoreFocus: boolean) => void }> = ({ onDone }) => {
  const aui = useAui()
  const title = useAuiState((s) => s.threadListItem.title) ?? ''
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const commit = (restoreFocus: boolean) => {
    if (settledRef.current) return
    settledRef.current = true

    const next = value.trim()
    if (!next || next === title) {
      onDone(restoreFocus)
      return
    }

    // Deferred so a synchronous throw lands on the rejection path too.
    Promise.resolve()
      .then(() => aui.threadListItem.rename(next))
      .then(
        () => onDone(restoreFocus),
        () => {
          settledRef.current = false
          if (restoreFocus) inputRef.current?.focus()
        },
      )
  }

  const cancel = () => {
    if (settledRef.current) return
    settledRef.current = true
    onDone(true)
  }

  return (
    <Input
      ref={inputRef}
      autoFocus
      data-slot="aui_thread-list-item-rename"
      aria-label="Rename thread"
      value={value}
      className="h-7 min-w-0 flex-1 border-border bg-transparent ps-2.5 pe-9 text-sm text-foreground placeholder:text-faint-foreground focus-visible:border-ring focus-visible:ring-0"
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
  )
}

const ThreadListItemMore: FC<{ onRename: () => void }> = ({ onRename }) => {
  return (
    <ThreadListItemMorePrimitive.Root sharedFocusGroup>
      <ThreadListItemMorePrimitive.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            data-slot="aui_thread-list-item-more"
            className="sidebar-accessory absolute end-1 top-1/2 size-6 -translate-y-1/2 rounded-md p-0 text-faint-foreground hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0 data-[state=open]:bg-selected data-[state=open]:text-foreground data-[state=open]:hover:bg-selected"
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
        className="material-raised data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl p-1.5"
      >
        <ThreadListItemMorePrimitive.Item
          data-slot="aui_thread-list-item-more-item"
          className="text-muted-foreground hover:bg-hover hover:text-foreground focus:bg-hover focus:text-foreground active:bg-active data-highlighted:bg-hover data-highlighted:text-foreground transition-colors flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
          onSelect={onRename}
        >
          Rename
        </ThreadListItemMorePrimitive.Item>
        <ThreadListItemPrimitive.Archive
          render={
            <ThreadListItemMorePrimitive.Item
              data-slot="aui_thread-list-item-more-item"
              className="text-muted-foreground hover:bg-hover hover:text-foreground focus:bg-hover focus:text-foreground active:bg-active data-highlighted:bg-hover data-highlighted:text-foreground transition-colors flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
            />
          }
        >
          Archive
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete
          render={
            <ThreadListItemMorePrimitive.Item
              data-slot="aui_thread-list-item-more-item"
              className="text-muted-foreground hover:bg-hover hover:text-foreground focus:bg-hover focus:text-foreground active:bg-active data-highlighted:bg-hover data-highlighted:text-foreground transition-colors flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
            />
          }
        >
          Delete
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  )
}

