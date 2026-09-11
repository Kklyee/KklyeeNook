'use client'

import { Button } from '@/renderer/src/components/ui/button'
import { Input } from '@/renderer/src/components/ui/input'
import { Skeleton } from '@/renderer/src/components/ui/skeleton'
import { useSidebar } from '@/renderer/src/components/ui/sidebar'
import { cn } from '@/renderer/src/lib/utils'
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react'
import {
  ArchiveIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from 'lucide-react'
import {
  forwardRef,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from 'react'

export const ThreadList: FC = () => {
  const [search, setSearch] = useState('')
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0)
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile

  return (
    <ThreadListRoot>
      <ThreadListNew />
      {hasThreads && <ThreadListSearch value={search} onValueChange={setSearch} />}
      {hasThreads && !collapsed && (
        <div className="px-2 pt-3 pb-0.5 text-[11px] font-medium text-sidebar-foreground/45">
          会话
        </div>
      )}
      <ThreadListItems searchQuery={hasThreads ? search : ''} />
    </ThreadListRoot>
  )
}

export const ThreadListSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, 'value' | 'onChange'> & {
    value: string
    onValueChange: (value: string) => void
  }
>(({ className, value, onValueChange, ...props }, ref) => {
  const { isMobile, setOpen, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="aui_thread-list-search-collapsed"
        className="mx-auto size-8 rounded-lg text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        aria-label="展开并搜索对话"
        title="搜索对话"
        onClick={() => setOpen(true)}
      >
        <SearchIcon className="size-4" />
      </Button>
    )
  }

  return (
    <div data-slot="aui_thread-list-search" className="relative py-1">
      <SearchIcon
        data-slot="aui_thread-list-search-icon"
        className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/45"
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label="搜索对话"
        placeholder="搜索对话"
        className={cn(
          'h-8 rounded-lg border-transparent bg-transparent ps-8 text-xs text-sidebar-foreground shadow-none placeholder:text-sidebar-foreground/45 hover:bg-sidebar-accent focus-visible:border-sidebar-ring focus-visible:bg-sidebar-accent focus-visible:ring-1',
          className,
        )}
        {...props}
      />
    </div>
  )
})

ThreadListSearch.displayName = 'ThreadListSearch'

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

export const ThreadListItems: FC<ComponentPropsWithoutRef<'div'> & { searchQuery?: string }> = ({
  className,
  searchQuery = '',
  ...props
}) => {
  const { isMobile, state } = useSidebar()

  if (state === 'collapsed' && !isMobile) return null

  return (
    <div
      data-slot="aui_thread-list-items"
      className={cn('flex flex-col gap-0.5', className)}
      {...props}
    >
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListItemGroups searchQuery={searchQuery} />
      </AuiIf>
    </div>
  )
}

const DAY_IN_MS = 86_400_000

const dateGroupLabel = (date: Date | undefined, startOfToday: number): string => {
  if (!date || date.getTime() >= startOfToday) return '今天'
  if (date.getTime() >= startOfToday - DAY_IN_MS) return '昨天'
  return '更早'
}

export type ThreadListGroup = { label: string; indices: number[] }

/**
 * Filters the thread list by title and buckets the matches by last activity
 * (Today, Yesterday, Earlier). `groups` is null when no thread carries a
 * date, in which case `filteredIndices` keeps the runtime order.
 */
export const useThreadListGroups = (searchQuery = '') => {
  const threadIds = useAuiState((s) => s.threads.threadIds)
  const threadItems = useAuiState((s) => s.threads.threadItems)

  const query = searchQuery.trim().toLowerCase()

  return useMemo(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]))
    const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt)
    const filteredIndices = threadIds
      .map((id, index) => ({ id, index }))
      .filter(
        ({ id }) =>
          !query || (itemsById.get(id)?.title || 'New Chat').toLowerCase().includes(query),
      )
      .map(({ index }) => index)
    if (!filteredIndices.some((index) => dates[index])) {
      return { threadIds, filteredIndices, groups: null }
    }

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const time = (index: number) => dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER
    const sorted = [...filteredIndices].sort((a, b) => time(b) - time(a))

    const result: ThreadListGroup[] = []
    for (const index of sorted) {
      const label = dateGroupLabel(dates[index], startOfToday)
      const lastGroup = result[result.length - 1]
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index)
      } else {
        result.push({ label, indices: [index] })
      }
    }
    return { threadIds, filteredIndices, groups: result }
  }, [threadIds, threadItems, query])
}

const ThreadListItemGroups: FC<{ searchQuery?: string }> = ({ searchQuery = '' }) => {
  const { threadIds, filteredIndices, groups } = useThreadListGroups(searchQuery)
  const query = searchQuery.trim()

  if (query && filteredIndices.length === 0) {
    return (
      <div data-slot="aui_thread-list-empty" className="text-muted-foreground px-2.5 py-4 text-sm">
        没有找到对话
      </div>
    )
  }

  if (!groups) {
    return filteredIndices.map((index) => (
      <ThreadListPrimitive.ItemByIndex
        key={threadIds[index]}
        index={index}
        components={{ ThreadListItem }}
      />
    ))
  }

  return groups.map((group) => (
    <Fragment key={group.label}>
      <div
        data-slot="aui_thread-list-group-label"
        className="px-2 pt-4 pb-1.5 text-[11px] font-medium text-sidebar-foreground/45"
      >
        {group.label}
      </div>
      {group.indices.map((index) => (
        <ThreadListPrimitive.ItemByIndex
          key={threadIds[index]}
          index={index}
          components={{ ThreadListItem }}
        />
      ))}
    </Fragment>
  ))
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
        <Button
          ref={ref}
          variant="ghost"
          data-slot="aui_thread-list-new"
          className={cn(
            collapsed
              ? 'mx-auto size-8 justify-center rounded-lg p-0'
              : 'h-8 justify-start gap-2 rounded-lg px-2 text-sm font-normal',
            'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent',
            className,
          )}
          aria-label={collapsed ? '新建对话' : undefined}
          title={collapsed ? '新建对话' : undefined}
          {...props}
        />
      }
    >
      {collapsed ? (
        <PlusIcon data-slot="aui_thread-list-new-icon" className="size-4" />
      ) : (
        (children ?? (
          <>
            <PlusIcon data-slot="aui_thread-list-new-icon" className="size-4 shrink-0" />
            <span
              data-slot="aui_thread-list-new-label"
              className={cn('whitespace-nowrap', labelClassName)}
            >
              新对话
            </span>
          </>
        ))
      )}
    </ThreadListPrimitive.New>
  )
})

ThreadListNew.displayName = 'ThreadListNew'

const ThreadListSkeleton: FC = () => {
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label="Loading threads"
          data-slot="aui_thread-list-skeleton-wrapper"
          className="flex h-8 items-center px-2.5"
        >
          <Skeleton data-slot="aui_thread-list-skeleton" className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  )
}

export const ThreadListItem: FC = () => {
  const isRunning = useAuiState((s) => s.threadListItem.isRunning)
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
      className="group relative flex h-8 items-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground has-focus-visible:bg-sidebar-accent has-data-[state=open]:bg-sidebar-accent focus-visible:outline-none"
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
          className="flex h-full min-w-0 flex-1 items-center rounded-lg px-2 text-start text-xs outline-none group-hover:pe-8 group-has-focus-visible:pe-8 group-has-data-[state=open]:pe-8 group-data-active:pe-8 focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          {isRunning && (
            <Loader2Icon
              aria-hidden
              data-slot="aui_thread-list-item-running"
              className="text-muted-foreground me-1.5 size-3.5 shrink-0 animate-spin"
            />
          )}
          <span data-slot="aui_thread-list-item-title" className="min-w-0 flex-1 truncate">
            <ThreadListItemPrimitive.Title fallback="新对话" />
          </span>
          {isRunning && <span className="sr-only">Running</span>}
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
      className="h-7 min-w-0 flex-1 ps-2.5 pe-9 text-sm"
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
            className="absolute end-1 top-1/2 size-6 -translate-y-1/2 rounded-md p-0 text-sidebar-foreground/45 opacity-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-active:opacity-100 data-[state=open]:bg-sidebar-accent data-[state=open]:opacity-100"
          />
        }
      >
        <MoreHorizontalIcon className="size-3.5" />
        <span className="sr-only">More options</span>
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        side="right"
        align="start"
        sideOffset={6}
        data-slot="aui_thread-list-item-more-content"
        className="bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl border p-1.5"
      >
        <ThreadListItemMorePrimitive.Item
          data-slot="aui_thread-list-item-more-item"
          className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
          onSelect={onRename}
        >
          <PencilIcon className="size-4" />
          Rename
        </ThreadListItemMorePrimitive.Item>
        <ThreadListItemPrimitive.Archive
          render={
            <ThreadListItemMorePrimitive.Item
              data-slot="aui_thread-list-item-more-item"
              className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
            />
          }
        >
          <ArchiveIcon className="size-4" />
          Archive
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete
          render={
            <ThreadListItemMorePrimitive.Item
              data-slot="aui_thread-list-item-more-item"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
            />
          }
        >
          <TrashIcon className="size-4" />
          Delete
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  )
}
