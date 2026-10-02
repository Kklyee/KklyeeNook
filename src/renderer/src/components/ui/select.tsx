import { Select as SelectPrimitive } from '@base-ui/react/select'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

import { cn } from '@/renderer/src/lib/utils'

function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectPrimitive.Root.Props<Value, Multiple>,
) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-glass-border bg-glass-hover px-2.5 text-sm text-text-default outline-none transition-colors hover:border-glass-border-hover hover:bg-interactive-hover active:bg-interactive-pressed focus-visible:border-brand-border focus-visible:ring-2 focus-visible:ring-brand-soft disabled:pointer-events-none disabled:opacity-50 data-popup-open:border-brand-border data-popup-open:bg-interactive-selected data-popup-open:ring-2 data-popup-open:ring-brand-soft',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
    </SelectPrimitive.Trigger>
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn('line-clamp-1', className)}
      {...props}
    />
  )
}

function SelectContent({
  className,
  children,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props & { alignItemWithTrigger?: boolean }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="isolate z-50"
        sideOffset={4}
        alignItemWithTrigger={alignItemWithTrigger}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'glass-surface min-w-(--anchor-width) overflow-hidden rounded-xl p-1.5 text-sm outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List className="max-h-[min(20rem,var(--available-height,70vh))] overflow-y-auto">
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-center rounded-lg py-1.5 pr-8 pl-2 text-sm text-text-default outline-none transition-colors select-none data-highlighted:bg-interactive-hover data-highlighted:text-text-strong data-selected:bg-interactive-selected data-selected:text-text-strong data-selected:data-highlighted:bg-interactive-selected-hover active:bg-interactive-pressed data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
