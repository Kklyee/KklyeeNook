'use client'

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDownIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/renderer/src/components/ui/collapsible'
import { cn } from '@/renderer/src/lib/utils'

export const ANIMATION_DURATION = 200

const ReasoningPreviewContext = createContext(false)

const reasoningVariants = cva('aui-reasoning-root w-full', {
  variants: {
    variant: {
      outline: 'material-control rounded-lg px-3 py-2',
      ghost: '',
      muted: 'material-control rounded-lg px-3 py-2',
    },
  },
  defaultVariants: { variant: 'ghost' },
})

export type ReasoningRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    defaultOpen?: boolean
    streaming?: boolean
    /** Called right before the disclosure animates, on toggle and on streaming transitions. */
    onAnimationStart?: () => void
  }

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = true,
  streaming,
  onAnimationStart,
  children,
  ...props
}: ReasoningRootProps) {
  const initialOpenRef = useRef(defaultOpen)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : (userOpen ?? (streaming || initialOpenRef.current))
  const isPreview = streaming === true && isOpen

  const prevStreamingRef = useRef(streaming)
  useLayoutEffect(() => {
    if (prevStreamingRef.current === streaming) return
    prevStreamingRef.current = streaming
    // A streaming transition only animates the panel when the resting state
    // is collapsed; with `defaultOpen` the disclosure stays open across it.
    if (!isControlled && userOpen === null && !initialOpenRef.current) {
      onAnimationStart?.()
    }
  }, [streaming, isControlled, userOpen, onAnimationStart])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      onAnimationStart?.()
      if (!isControlled) {
        setUserOpen(open)
      }
      controlledOnOpenChange?.(open)
    },
    [onAnimationStart, isControlled, controlledOnOpenChange],
  )

  return (
    <Collapsible
      data-slot="reasoning-root"
      data-variant={variant}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('group/reasoning-root', reasoningVariants({ variant, className }))}
      style={{ '--animation-duration': `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      {...props}
    >
      <ReasoningPreviewContext.Provider value={isPreview}>
        {children}
      </ReasoningPreviewContext.Provider>
    </Collapsible>
  )
}

function ReasoningFade({
  side = 'bottom',
  className,
  ...props
}: React.ComponentProps<'div'> & { side?: 'top' | 'bottom' }) {
  if (side === 'top') {
    return (
      <div
        data-slot="reasoning-fade"
        className={cn(
          'aui-reasoning-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-8',
          'bg-[linear-gradient(to_bottom,var(--color-background),transparent)]',
          'group-data-[variant=muted]/reasoning-root:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--color-muted)_50%,var(--color-background)),transparent)]',
          'fade-in-0 animate-in',
          'animation-duration-(--animation-duration)',
          className,
        )}
        {...props}
      />
    )
  }

  return (
    <div
      data-slot="reasoning-fade"
      className={cn(
        'aui-reasoning-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8',
        'bg-[linear-gradient(to_top,var(--color-background),transparent)]',
        'group-data-[variant=muted]/reasoning-root:bg-[linear-gradient(to_top,color-mix(in_oklab,var(--color-muted)_50%,var(--color-background)),transparent)]',
        'fade-in-0 animate-in',
        'animation-duration-(--animation-duration)',
        className,
      )}
      {...props}
    />
  )
}

function ReasoningTrigger({
  active,
  duration,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & { active?: boolean; duration?: number }) {
  const durationText = duration ? ` (${duration}s)` : ''

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      className={cn(
        'aui-reasoning-trigger group/trigger text-muted-foreground hover:text-foreground flex max-w-[75%] origin-left items-center gap-1.5 py-1 text-sm transition-[color,scale] active:scale-[0.98]',
        className,
      )}
      {...props}
    >
      <span
        data-slot="reasoning-trigger-label"
        className={cn(
          'aui-reasoning-trigger-label-wrapper inline-block leading-none tabular-nums',
          active && 'shimmer motion-reduce:animate-none',
        )}
      >
        Thinking{durationText}
      </span>
      <ChevronDownIcon
        data-slot="reasoning-trigger-chevron"
        className={cn(
          'aui-reasoning-trigger-chevron mt-0.5 size-3.5 shrink-0',
          'transition-transform duration-(--animation-duration) ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
          '-rotate-90',
          'group-data-open/trigger:rotate-0',
          'group-data-panel-open/trigger:rotate-0',
        )}
      />
    </CollapsibleTrigger>
  )
}

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  const isPreview = useContext(ReasoningPreviewContext)

  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        'aui-reasoning-content text-muted-foreground relative overflow-hidden text-sm outline-none',
        'group/collapsible-content ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none',
        'data-closed:animate-collapsible-up',
        'data-open:animate-collapsible-down',
        'data-closed:fill-mode-forwards',
        'data-closed:pointer-events-none',
        '[--tw-duration:var(--animation-duration)]',
        className,
      )}
      {...props}
    >
      <ReasoningFade side="top" />
      {children}
      {isPreview ? <ReasoningFade /> : null}
    </CollapsibleContent>
  )
}

function ReasoningText({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="reasoning-text"
      className={cn(
        'aui-reasoning-text relative z-0 pt-1 pb-1 leading-relaxed text-pretty',
        'transform-gpu transition-[transform,opacity] ease-[cubic-bezier(0.32,0.72,0,1)]',
        'motion-reduce:animate-none',
        'group-data-open/collapsible-content:animate-in',
        'group-data-closed/collapsible-content:animate-out',
        'group-data-open/collapsible-content:fade-in-0',
        'group-data-closed/collapsible-content:fade-out-0',
        'group-data-open/collapsible-content:slide-in-from-top-4',
        'group-data-closed/collapsible-content:slide-out-to-top-4',
        'group-data-open/collapsible-content:blur-in-[2px]',
        'group-data-closed/collapsible-content:blur-out-[2px]',
        'group-data-open/collapsible-content:animation-duration-(--animation-duration)',
        'group-data-closed/collapsible-content:animation-duration-(--animation-duration)',
        className,
      )}
      {...props}
    >
      <div className="aui-reasoning-text-content space-y-4">
        {children}
      </div>
    </div>
  )
}

export {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants,
}
