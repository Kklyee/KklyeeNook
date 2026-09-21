import { useEffect, useState, type ReactNode } from 'react'
import { BotIcon, Maximize2Icon, Minimize2Icon, MinusIcon, XIcon } from 'lucide-react'
import { Button } from './ui/button'

export function Titlebar() {
  const [maximized, setMaximized] = useState(false)

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
    <header className="titlebar-drag-region bg-sidebar text-sidebar-foreground flex h-10 shrink-0 items-center border-b border-sidebar-border">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <span className="bg-sidebar-primary text-sidebar-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-md">
          <BotIcon className="size-3" />
        </span>
        <span className="truncate text-xs font-semibold tracking-wide">KklyeeNook</span>
      </div>
      <div className="titlebar-no-drag-region flex h-full shrink-0 items-stretch">
        <WindowButton label="最小化" onClick={() => window.api.window.minimize()}>
          <MinusIcon />
        </WindowButton>
        <WindowButton
          label={maximized ? '还原' : '最大化'}
          onClick={() => window.api.window.toggleMaximize()}
        >
          {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
        </WindowButton>
        <WindowButton
          label="关闭"
          className="hover:bg-destructive hover:text-destructive-foreground"
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
      className={`h-full w-11 rounded-none px-0 text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground ${className ?? ''}`}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
