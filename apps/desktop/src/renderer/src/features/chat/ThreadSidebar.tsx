import { type ComponentProps } from 'react'
import { cn } from '@/renderer/src/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarRail,
} from '@/renderer/src/components/ui/sidebar'
import { ThreadList } from '@/renderer/src/components/assistant-ui/elements/thread-list.aui'

export function ThreadSidebar({ className, ...props }: ComponentProps<typeof Sidebar>) {
  const canCollapse = props.collapsible !== 'none'

  return (
    <Sidebar className={cn('border-border ', className)} {...props}>
      <SidebarContent className="thread-sidebar-scroll px-2 pt-2 pb-2 group-data-[collapsible=icon]:px-1.5">
        <ThreadList />
      </SidebarContent>
      {canCollapse && <SidebarRail />}
    </Sidebar>
  )
}
