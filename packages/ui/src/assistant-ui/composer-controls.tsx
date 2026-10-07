import type { ComponentProps } from 'react'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { iconSwap, iconSwapIn, iconSwapOut } from '../lib/surfaces'

export function ComposerBar({
  dragActive = false,
  className,
  ...props
}: ComponentProps<'div'> & { dragActive?: boolean }) {
  return (
    <div
      data-slot="composer-bar"
      data-drag-active={dragActive || undefined}
      className={cn(
        'material-control flex w-full flex-col gap-2 rounded-[14px] p-2.5 transition-colors',
        dragActive && 'border-ring bg-brand-muted',
        className,
      )}
      {...props}
    />
  )
}

export function ComposerSend({
  streaming,
  idle: _idle,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & { streaming: boolean; idle: boolean }) {
  return (
    <button
      type="button"
      aria-label={streaming ? 'Stop generating' : 'Send message'}
      data-slot="composer-send"
      className={cn(
        'grid size-8 place-items-center rounded-full',
        'bg-brand text-brand-foreground transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:opacity-90 active:scale-[0.96] motion-reduce:transition-none',
        className,
      )}
      {...props}
    >
      <ArrowUpIcon
        className={cn(
          iconSwap,
          'size-4 stroke-brand-foreground',
          streaming ? iconSwapOut : iconSwapIn,
        )}
      />
      <SquareIcon
        className={cn(iconSwap, 'size-3 fill-current', streaming ? iconSwapIn : iconSwapOut)}
      />
    </button>
  )
}
