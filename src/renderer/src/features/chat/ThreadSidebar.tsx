import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { BotIcon, ChevronsUpDownIcon, SettingsIcon } from 'lucide-react'
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

function SidebarAccountMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="应用菜单"
          className={cn(
            'bg-popover text-popover-foreground absolute bottom-full z-50 mb-2 w-56 rounded-2xl border p-2 shadow-xl',
            collapsed ? 'left-0' : 'inset-x-0 w-auto',
          )}
        >
          <div className="flex items-center gap-3 px-2 py-2.5">
            <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
              <BotIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">KklyeeNook</p>
              <p className="text-muted-foreground truncate text-xs">本地工作区</p>
            </div>
          </div>
          <div className="my-1 border-t" />
          <button
            type="button"
            role="menuitem"
            className="hover:bg-accent hover:text-accent-foreground flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            <SettingsIcon className="text-muted-foreground size-4" />
            <span className="flex-1">设置</span>
          </button>
          <a
            href="https://github.com/assistant-ui/assistant-ui"
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            className="hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setOpen(false)}
          >
            <GitHubIcon className="text-muted-foreground size-4" />
            <span>GitHub</span>
          </a>
        </div>
      )}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip="应用菜单"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              collapsed ? 'mx-auto size-8! justify-center rounded-lg p-0!' : 'h-10 rounded-lg px-2',
              'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full">
              <BotIcon className="size-3.5" />
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate text-left">KklyeeNook</span>
                <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
              </>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  )
}

export function ThreadSidebar({
  className,
  onOpenSettings,
  ...props
}: ComponentProps<typeof Sidebar> & { onOpenSettings: () => void }) {
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
        <SidebarAccountMenu onOpenSettings={onOpenSettings} />
      </SidebarFooter>
    </Sidebar>
  )
}
