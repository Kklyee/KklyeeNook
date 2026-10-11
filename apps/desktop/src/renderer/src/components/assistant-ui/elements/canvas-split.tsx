import type { ComponentProps } from 'react'
import { cn } from '@/renderer/src/lib/utils'

export function CanvasSplit({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="canvas-split"
      className={cn('flex h-full min-h-0 w-full flex-row overflow-hidden', className)}
      {...props}
    />
  )
}

export function CanvasSplitDocument({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="canvas-split-document"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}
      {...props}
    />
  )
}
