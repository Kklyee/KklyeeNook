import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftIcon, CopyIcon, MinusIcon, PanelLeftIcon, SquareIcon, XIcon } from 'lucide-react'
import { Button } from './ui/button'
import { useSidebar } from './ui/sidebar'

export type AppView = 'chat' | 'settings' | 'scheduled-tasks'

const navigation: Array<{ id: AppView; label: string }> = [
  { id: 'chat', label: '对话' },
  { id: 'scheduled-tasks', label: '定时任务' },
  { id: 'settings', label: '设置' },
]

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

  return (
    <header className="titlebar-drag-region flex h-7 shrink-0 items-center border-b border-white/[0.06] bg-[#1b1b1b] text-white/75">
      <div className="titlebar-no-drag-region flex h-full min-w-0 flex-1 items-center">
        <Button
          type="button"
          variant="ghost"
          aria-label={view === 'chat' ? '折叠或展开侧边栏' : '返回对话'}
          title={view === 'chat' ? '折叠或展开侧边栏' : '返回对话'}
          className="h-full w-9 rounded-none px-0 text-white/60 hover:bg-white/[0.08] hover:text-white"
          onClick={() => (view === 'chat' ? toggleSidebar() : onNavigate('chat'))}
        >
          {view === 'chat' ? (
            <PanelLeftIcon className="size-3.5" />
          ) : (
            <ArrowLeftIcon className="size-3.5" />
          )}
        </Button>
        <nav aria-label="应用导航" className="flex h-full items-center">
          {navigation.map(({ id, label }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              aria-current={view === id ? 'page' : undefined}
              className="h-full rounded-none px-2.5 text-[11px] font-normal text-white/60 hover:bg-white/[0.07] hover:text-white/90 aria-[current=page]:text-white/95"
              onClick={() => onNavigate(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
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
      className={`h-full w-11 rounded-none px-0 text-white/65 hover:bg-white/[0.09] hover:text-white ${className ?? ''}`}
      onClick={onClick}
    >
      <span className="[&_svg]:size-3.5">{children}</span>
    </Button>
  )
}
