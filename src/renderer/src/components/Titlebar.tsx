import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { CopyIcon, MinusIcon, PanelLeftIcon, SquareIcon, XIcon } from 'lucide-react'
import { Button } from './ui/button'
import { useSidebar } from './ui/sidebar'
import type { WindowMenu } from '@/shared/ipc/channels'

export type AppView = 'chat' | 'settings' | 'scheduled-tasks'

export function Titlebar({
  view,
  onNavigate,
}: {
  view: AppView
  onNavigate: (view: AppView) => void
}) {
  const [maximized, setMaximized] = useState(false)
  const { toggleSidebar } = useSidebar()

  useEffect(() => {
    let active = true
    const unsubscribe = window.api.window.onMaximizedChanged(setMaximized)
    void window.api.window.isMaximized().then((value) => {
      if (active) setMaximized(value)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    return window.api.window.onMenuAction((action) => {
      if (action === 'settings') onNavigate('settings')
    })
  }, [onNavigate])

  const openMenu = (menu: WindowMenu, event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    window.api.window.showMenu(menu, Math.round(bounds.left), Math.round(bounds.bottom))
  }

  return (
    <header className="titlebar-drag-region flex h-7 shrink-0 items-center border-b border-border bg-(--ui-titlebar) text-foreground">
      <div className="titlebar-no-drag-region flex h-full min-w-0 flex-1 items-center">
        <Button
          type="button"
          variant="ghost"
          aria-label={view === 'chat' ? '折叠或展开侧边栏' : '返回对话'}
          title={view === 'chat' ? '折叠或展开侧边栏' : '返回对话'}
          className="h-full w-9 rounded-none px-0 text-muted-foreground hover:bg-hover hover:text-foreground"
          onClick={() => (view === 'chat' ? toggleSidebar() : onNavigate('chat'))}
        >
          <PanelLeftIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-haspopup="menu"
          className="h-full rounded-none px-2.5 text-[11px] font-normal text-muted-foreground hover:bg-hover hover:text-foreground"
          onClick={(event) => openMenu('application', event)}
        >
          应用
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-haspopup="menu"
          className="h-full rounded-none px-2.5 text-[11px] font-normal text-muted-foreground hover:bg-hover hover:text-foreground"
          onClick={(event) => openMenu('edit', event)}
        >
          编辑
        </Button>
      </div>
      <div className="titlebar-no-drag-region flex h-full shrink-0 items-stretch">
        <WindowButton label="最小化" onClick={() => window.api.window.minimize()}>
          <MinusIcon />
        </WindowButton>
        <WindowButton
          label={maximized ? '还原' : '最大化'}
          onClick={() => window.api.window.toggleMaximize()}
        >
          {maximized ? <CopyIcon /> : <SquareIcon />}
        </WindowButton>
        <WindowButton
          label="关闭"
          className="hover:bg-[#c42b1c] hover:text-white"
          onClick={() => window.api.window.close()}
        >
          <XIcon />
        </WindowButton>
      </div>
    </header>
  )
}

function WindowButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      title={label}
      className={`h-full w-11 rounded-none px-0 text-muted-foreground hover:bg-hover hover:text-foreground ${className ?? ''}`}
      onClick={onClick}
    >
      <span className="[&_svg]:size-3.5">{children}</span>
    </Button>
  )
}
