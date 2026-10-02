import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { cn } from '@/renderer/src/lib/utils'
import { PreviewPanel } from './PreviewPanel'
import { CanvasSplit } from '@/renderer/src/components/assistant-ui/elements/canvas-split'
import { usePreview } from './PreviewProvider'

export function ChatWorkspace({ children }: { children: ReactNode }) {
  const preview = usePreview()
  const container = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const focused = !!preview.target && preview.placement === 'focus'
  const left = preview.placement === 'left'
  const maxWidth = containerWidth * 0.65
  const minWidth = Math.min(340, maxWidth)
  const paneWidth = Math.min(maxWidth, Math.max(minWidth, (containerWidth * preview.width) / 100))

  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setContainerWidth(entries[0]!.contentRect.width),
    )
    observer.observe(container.current!)
    return () => observer.disconnect()
  }, [])

  const resizeAt = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = container.current!.getBoundingClientRect()
    const requested = left ? event.clientX - bounds.left : bounds.right - event.clientX
    preview.resize(
      Math.min(65, Math.max((minWidth / bounds.width) * 100, (requested / bounds.width) * 100)),
    )
  }

  return (
    <CanvasSplit ref={container} data-placement={preview.target ? preview.placement : undefined}>
      <div
        data-slot="primary-pane"
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col',
          focused && 'hidden',
          left && 'order-3',
        )}
      >
        {children}
      </div>
      {preview.target && (
        <>
          {!focused && (
            <div
              role="separator"
              aria-label="调整预览宽度"
              aria-orientation="vertical"
              tabIndex={0}
              aria-valuemin={Math.round((minWidth / containerWidth) * 100) || 0}
              aria-valuemax={65}
              aria-valuenow={Math.round(preview.width)}
              className="bg-border/60 hover:bg-primary/40 focus-visible:bg-primary/40 order-2 w-1 shrink-0 touch-none cursor-col-resize outline-none"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                resizeAt(event)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeAt(event)
              }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                const direction = (event.key === 'ArrowRight' ? 1 : -1) * (left ? 1 : -1)
                preview.resize(
                  Math.min(
                    65,
                    Math.max((minWidth / containerWidth) * 100, preview.width + direction * 2),
                  ),
                )
              }}
            />
          )}
          <div
            className={cn(
              'min-h-0 min-w-0 shrink-0',
              left ? 'order-1' : 'order-3',
              focused && 'flex-1',
            )}
            style={focused ? undefined : { width: paneWidth || `${preview.width}%` }}
          >
            <PreviewPanel />
          </div>
        </>
      )}
    </CanvasSplit>
  )
}
