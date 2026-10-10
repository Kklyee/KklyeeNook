import type { ComponentProps, ReactNode } from 'react'
import { LoaderCircleIcon } from 'lucide-react'
import { Button } from '../components/button'
import { cn } from '../lib/utils'

export const threadListRowClassName =
  'sidebar-row group relative flex h-[34px] items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:bg-hover active:bg-active active:text-foreground data-active:bg-selected data-active:hover:bg-selected data-active:text-foreground has-focus-visible:bg-hover has-data-[state=open]:bg-selected has-data-[state=open]:text-foreground focus-visible:outline-none'
export const threadListTriggerClassName =
  'flex h-full min-w-0 flex-1 items-center rounded-lg pe-8 ps-8 text-start text-[13px] outline-none focus-visible:border-ring focus-visible:ring-0'

export function ThreadListRowContent({
  title,
  running,
  waiting,
}: {
  title: ReactNode
  running?: boolean
  waiting?: boolean
  updatedAt?: number
}) {
  return (
    <>
      <span data-slot="aui_thread-list-item-title" className="min-w-0 flex-1 truncate">
        {title}
      </span>
      {running && (
        <LoaderCircleIcon
          aria-label="运行中"
          data-slot="aui_thread-list-item-running"
          className="me-1.5 size-3 shrink-0 animate-spin text-faint-foreground"
          strokeWidth={1.5}
        />
      )}
      {waiting && <span className="me-1.5 shrink-0 text-[10px] text-faint-foreground">等待</span>}
    </>
  )
}

export function ThreadListRow({
  title,
  running,
  updatedAt,
  active,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'title'> & {
  title: string
  running?: boolean
  updatedAt?: number
  active?: boolean
}) {
  return (
    <Button
      variant="ghost"
      data-slot="aui_thread-list-item"
      data-active={active || undefined}
      className={cn(
        threadListRowClassName,
        threadListTriggerClassName,
        'min-h-11 w-full justify-start pe-3 font-normal',
        className,
      )}
      {...props}
    >
      <ThreadListRowContent title={title} running={running} updatedAt={updatedAt} />
    </Button>
  )
}
