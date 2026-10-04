import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { CornerDownRightIcon } from 'lucide-react'
import { Button } from '@/renderer/src/components/ui/button'
import { cn } from '@/renderer/src/lib/utils'

export interface QueuedMessage {
  id: string
  text: string
  steer: boolean
}

export function MessageQueue({
  queued,
  onClear,
  clearing,
  error,
  className,
  ...props
}: ComponentProps<'div'> & {
  queued: readonly QueuedMessage[]
  onClear: () => void
  clearing: boolean
  error?: string
}) {
  const visible = queued.length > 0
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const content = contentRef.current!
    const observer = new ResizeObserver(() => setHeight(content.getBoundingClientRect().height))
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      data-slot="message-queue"
      className={cn(
        'overflow-hidden transition-[height,opacity,transform] duration-150 motion-reduce:transition-none',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-0.5',
        className,
      )}
      aria-hidden={!visible}
      {...props}
      style={{ ...props.style, height: visible ? height : 0 }}
    >
      <div ref={contentRef} className="flow-root">
        <section
          className="bg-surface-muted border-border mb-1.5 rounded-[9px] border px-3 py-2"
          aria-label="待执行消息"
        >
          <div className="text-faint-foreground flex items-center justify-between text-[11px]">
            <span aria-live="polite">已排队 {queued.length} 条</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-faint-foreground h-5 px-1 text-[11px]"
              onClick={onClear}
              disabled={clearing}
              tabIndex={visible ? 0 : -1}
            >
              清空
            </Button>
          </div>
          <ol className="text-muted-foreground mt-1 flex flex-col gap-1 text-[13px]">
            {queued.slice(0, 3).map((message, index) => (
              <li key={message.id} className="flex min-w-0 gap-2">
                <span className="text-faint-foreground w-3 shrink-0 tabular-nums">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  {message.steer && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <CornerDownRightIcon className="size-3" />
                      调整当前任务
                    </span>
                  )}
                  <p className="truncate">{message.text}</p>
                </div>
              </li>
            ))}
          </ol>
          {queued.length > 3 && (
            <p className="text-faint-foreground mt-1 pl-5 text-[11px]">
              还有 {queued.length - 3} 条…
            </p>
          )}
          {error && (
            <p role="alert" className="text-muted-foreground mt-1 text-[11px]">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
