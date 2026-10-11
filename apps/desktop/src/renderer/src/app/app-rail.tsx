import { cn } from '@/renderer/src/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import {
  primaryNavigation,
  settingsNavigationItem,
  type AppNavigationItem,
  type AppView,
} from './navigation'

export function AppRail({
  view,
  onNavigate,
}: {
  view: AppView
  onNavigate: (view: AppView) => void
}) {
  return (
    <TooltipProvider>
      <nav
        aria-label="主导航"
        className="app-rail border-border bg-(--ui-titlebar) flex w-(--app-rail-width) shrink-0 flex-col items-center gap-1.5 border-r px-1 py-2"
      >
        {primaryNavigation.map((item) => (
          <AppRailItem key={item.id} item={item} active={view === item.id} onNavigate={onNavigate} />
        ))}
        <div className="min-h-0 flex-1" />
        <AppRailItem
          item={settingsNavigationItem}
          active={view === 'settings'}
          onNavigate={onNavigate}
        />
      </nav>
    </TooltipProvider>
  )
}

function AppRailItem({
  item,
  active,
  onNavigate,
}: {
  item: AppNavigationItem
  active: boolean
  onNavigate: (view: AppView) => void
}) {
  const Icon = item.icon

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
            className={cn(
              'flex size-7 items-center justify-center rounded-md transition-colors outline-none',
              'focus-visible:ring-ring focus-visible:ring-2',
              active
                ? 'bg-selected text-foreground hover:bg-selected'
                : 'text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active',
            )}
          />
        }
      >
        <Icon className="size-3.5" strokeWidth={1.5} />
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
