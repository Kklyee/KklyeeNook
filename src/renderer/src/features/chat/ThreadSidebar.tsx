import type * as React from 'react'
import { BotIcon } from 'lucide-react'
import { GitHubIcon } from '@/renderer/src/components/icons/github'
import { Button } from '@/renderer/src/components/ui/button'
import { cn } from '@/renderer/src/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/renderer/src/components/ui/sidebar'
import { ThreadList } from '@/renderer/src/components/assistant-ui/elements/thread-list.aui'

function SidebarBrand({ canCollapse }: { canCollapse: boolean }) {
  const { isMobile, state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mx-auto size-8 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        aria-label="展开侧边栏"
        title="展开侧边栏"
        onClick={toggleSidebar}
      >
        <BotIcon className="size-4" />
      </Button>
    )
  }

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 px-1.5">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <BotIcon className="size-3.5" />
      </div>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">KklyeeNook</span>
      {canCollapse && (
        <SidebarTrigger className="size-7 shrink-0 rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
      )}
    </div>
  )
}

function SidebarRepositoryLink() {
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tooltip="GitHub"
          className={cn(
            collapsed ? 'mx-auto size-8! justify-center rounded-lg p-0!' : 'h-9 rounded-lg px-2',
            'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          )}
          render={
            <a
              href="https://github.com/assistant-ui/assistant-ui"
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <GitHubIcon className="size-4 shrink-0" />
          {!collapsed && <span className="truncate">GitHub</span>}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function ThreadSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const canCollapse = props.collapsible !== 'none'

  return (
    <Sidebar className={cn('border-sidebar-border', className)} {...props}>
      <SidebarHeader className="px-2 pt-2 pb-1 group-data-[collapsible=icon]:px-1.5">
        <SidebarBrand canCollapse={canCollapse} />
      </SidebarHeader>
      <SidebarContent className="px-2 pb-2 group-data-[collapsible=icon]:px-1.5">
        <ThreadList />
      </SidebarContent>
      {canCollapse && <SidebarRail />}
      <SidebarFooter className="border-sidebar-border border-t px-2 py-2 group-data-[collapsible=icon]:px-1.5">
        <SidebarRepositoryLink />
      </SidebarFooter>
    </Sidebar>
  )
}
