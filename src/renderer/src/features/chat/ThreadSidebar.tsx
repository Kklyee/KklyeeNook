import { type ComponentProps } from 'react'
import { BotIcon, CalendarClockIcon, SettingsIcon } from 'lucide-react'
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
        className="mx-auto size-8 rounded-lg text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0"
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
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-muted text-brand">
        <BotIcon className="size-3.5" />
      </div>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        KklyeeNook
      </span>
      {canCollapse && (
        <SidebarTrigger className="size-7 shrink-0 rounded-md text-faint-foreground hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0" />
      )}
    </div>
  )
}

function SidebarGlobalNav({
  onOpenSettings,
  onOpenScheduledTasks,
}: {
  onOpenSettings: () => void
  onOpenScheduledTasks: () => void
}) {
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile

  return (
    <SidebarMenu className="gap-0.5">
      <SidebarMenuItem>
        <SidebarMenuButton
          aria-label="定时任务"
          tooltip="定时任务"
          onClick={onOpenScheduledTasks}
          className={cn(
            collapsed ? 'mx-auto size-8 justify-center rounded-md p-0!' : 'h-9 rounded-md px-2.5',
            'text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0',
          )}
        >
          <CalendarClockIcon className="size-4" />
          {!collapsed && <span>定时任务</span>}
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          aria-label="设置"
          tooltip="设置"
          onClick={onOpenSettings}
          className={cn(
            collapsed ? 'mx-auto size-8 justify-center rounded-md p-0!' : 'h-9 rounded-md px-2.5',
            'text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active focus-visible:border-ring focus-visible:ring-0',
          )}
        >
          <SettingsIcon className="size-4" />
          {!collapsed && <span>设置</span>}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function ThreadSidebar({
  className,
  onOpenSettings,
  onOpenScheduledTasks,
  ...props
}: ComponentProps<typeof Sidebar> & {
  onOpenSettings: () => void
  onOpenScheduledTasks: () => void
}) {
  const canCollapse = props.collapsible !== 'none'

  return (
    <Sidebar className={cn('border-border', className)} {...props}>
      <SidebarHeader className="px-2 pt-2 pb-1 group-data-[collapsible=icon]:px-1.5">
        <SidebarBrand canCollapse={canCollapse} />
      </SidebarHeader>
      <SidebarContent className="px-2 pb-2 group-data-[collapsible=icon]:px-1.5">
        <ThreadList />
      </SidebarContent>
      {canCollapse && <SidebarRail />}
      <SidebarFooter className="border-t border-border px-2 py-2 group-data-[collapsible=icon]:px-1.5">
        <SidebarGlobalNav
          onOpenSettings={onOpenSettings}
          onOpenScheduledTasks={onOpenScheduledTasks}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
