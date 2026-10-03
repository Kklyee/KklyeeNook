'use client'

import {
  Children,
  Fragment,
  isValidElement,
  memo,
  useCallback,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { useScrollLock } from '@assistant-ui/react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/renderer/src/components/ui/collapsible'
import { cn } from '@/renderer/src/lib/utils'

const ANIMATION_DURATION = 200

function flattenToolGroupChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return flattenToolGroupChildren(child.props.children)
    }
    return [child]
  })
}

const toolGroupVariants = cva('aui-tool-group-root group/tool-group w-full', {
  variants: {
    variant: {
      outline:
        'rounded-lg py-1',
      ghost: '',
      muted:
        'rounded-lg py-1',
    },
  },
  defaultVariants: { variant: 'outline' },
})

export type ToolGroupRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> &
  VariantProps<typeof toolGroupVariants> & {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    defaultOpen?: boolean
  }

function ToolGroupRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = true,
  children,
  style,
  ...props
}: ToolGroupRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll()
      if (!isControlled) {
        setUncontrolledOpen(open)
      }
      controlledOnOpenChange?.(open)
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  )

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-group-root"
      data-variant={variant ?? 'outline'}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(toolGroupVariants({ variant }), 'group/tool-group-root', className)}
      style={{
        ...style,
        '--animation-duration': `${ANIMATION_DURATION}ms`,
      } as React.CSSProperties}
      {...props}
    >
      {children}
    </Collapsible>
  )
}

function ToolGroupTrigger({
  count,
  active = false,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  count: number
  active?: boolean
}) {
  const label = `${count} tool ${count === 1 ? 'call' : 'calls'}`

  return (
    <CollapsibleTrigger
      data-slot="tool-group-trigger"
      className={cn(
        'aui-tool-group-trigger group/trigger flex origin-left items-center gap-2 bg-transparent text-sm text-foreground transition-[color,scale,background-color] hover:bg-hover data-[state=open]:bg-selected active:scale-[0.98]',
        'group-data-[variant=ghost]/tool-group-root:py-1.5',
        'group-data-[variant=outline]/tool-group-root:w-full group-data-[variant=outline]/tool-group-root:px-4',
        'group-data-[variant=muted]/tool-group-root:w-full group-data-[variant=muted]/tool-group-root:px-4',
        className,
      )}
      {...props}
    >
      <span
        data-slot="tool-group-trigger-label"
        className={cn(
          'aui-tool-group-trigger-label-wrapper inline-block text-start text-xs leading-none font-medium text-muted-foreground',
          'group-data-[variant=ghost]/tool-group-root:font-normal',
          'group-data-[variant=outline]/tool-group-root:grow',
          'group-data-[variant=muted]/tool-group-root:grow',
          active && 'shimmer motion-reduce:animate-none',
        )}
      >
        {label}
      </span>
      <ChevronDownIcon
        data-slot="tool-group-trigger-chevron"
        className={cn(
          'aui-tool-group-trigger-chevron size-3 shrink-0 rounded-sm text-faint-foreground transition-[color,background-color,transform] group-hover/trigger:text-foreground hover:bg-hover',
          'duration-(--animation-duration) ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
          '-rotate-90',
          'group-data-open/trigger:rotate-0',
          'group-data-panel-open/trigger:rotate-0',
        )}
      />
    </CollapsibleTrigger>
  )
}

function ToolGroupContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  const toolGroupChildren = flattenToolGroupChildren(children)

  return (
    <CollapsibleContent
      data-slot="tool-group-content"
      className={cn(
        'aui-tool-group-content overflow-visible text-sm outline-none data-closed:overflow-hidden',
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
      <div
        data-slot="aui-tool-group-items"
        className={cn(
          'aui-tool-group-items mt-1.5 flex flex-col gap-1.5',
          'group-data-[variant=ghost]/tool-group-root:mt-1',
          'group-data-[variant=outline]/tool-group-root:mt-2 group-data-[variant=outline]/tool-group-root:border-t group-data-[variant=outline]/tool-group-root:border-border group-data-[variant=outline]/tool-group-root:px-3 group-data-[variant=outline]/tool-group-root:pt-2',
          'group-data-[variant=muted]/tool-group-root:mt-2 group-data-[variant=muted]/tool-group-root:border-t group-data-[variant=muted]/tool-group-root:border-border group-data-[variant=muted]/tool-group-root:px-3 group-data-[variant=muted]/tool-group-root:pt-2',
        )}
      >
        {toolGroupChildren.map((child, index) => (
          <div
            key={index}
            data-slot="aui-tool-group-node"
            style={{
              '--tool-call-connector-delay': `${index * 100}ms`,
            } as React.CSSProperties}
            className="aui-tool-group-node"
          >
            {child}
          </div>
        ))}
      </div>
    </CollapsibleContent>
  )
}

type ToolGroupComponent = FC<PropsWithChildren<{ startIndex: number; endIndex: number }>> & {
  Root: typeof ToolGroupRoot
  Trigger: typeof ToolGroupTrigger
  Content: typeof ToolGroupContent
}

const ToolGroupImpl: FC<PropsWithChildren<{ startIndex: number; endIndex: number }>> = ({
  children,
  startIndex,
  endIndex,
}) => {
  const toolCount = endIndex - startIndex + 1

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  )
}

/**
 * @deprecated This wrapper targets the legacy `components.ToolGroup` prop
 * on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>` with
 * a `groupBy` returning `"group-tool"` and compose `ToolGroupRoot` /
 * `ToolGroupTrigger` / `ToolGroupContent` directly. See `thread.tsx`.
 */
const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent

ToolGroup.displayName = 'ToolGroup'
ToolGroup.Root = ToolGroupRoot
ToolGroup.Trigger = ToolGroupTrigger
ToolGroup.Content = ToolGroupContent

export { ToolGroup, ToolGroupRoot, ToolGroupTrigger, ToolGroupContent, toolGroupVariants }
