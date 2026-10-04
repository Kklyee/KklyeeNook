import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownRightIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '@/renderer/src/components/ui/button'
import { Textarea } from '@/renderer/src/components/ui/textarea'
import { cn } from '@/renderer/src/lib/utils'

export interface QueuedMessage {
  id: string
  text: string
  steer: boolean
  index: number
  expected: string[]
}

export function MessageQueue({
  queued,
  onClear,
  onRemove,
  onSteer,
  onEdit,
  onMove,
  clearing,
  error,
  className,
  ...props
}: ComponentProps<'div'> & {
  queued: readonly QueuedMessage[]
  onClear: () => void
  onRemove: (message: QueuedMessage) => void
  onSteer: (message: QueuedMessage) => void
  onEdit: (message: QueuedMessage, text: string) => Promise<boolean>
  onMove: (message: QueuedMessage, offset: number) => void
  clearing: boolean
  error?: string
}) {
  const visible = queued.length > 0
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState<{ message: QueuedMessage; text: string }>()
  useEffect(() => {
    if (!visible) {
      setEditing(undefined)
      setExpanded(false)
    }
  }, [visible])
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
      inert={!visible}
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
              type="button"
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
          <ol className="text-muted-foreground mt-1 flex max-h-60 flex-col gap-1 overflow-y-auto text-[13px]">
            {(expanded ? queued : queued.slice(0, 3)).map((message, index) => (
              <li key={message.id} className="flex min-w-0 gap-2">
                <span className="text-faint-foreground w-3 shrink-0 tabular-nums">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  {message.steer && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <CornerDownRightIcon className="size-3" />
                      调整当前任务
                    </span>
                  )}
                  {editing?.message.id === message.id ? (
                    <div className="space-y-1">
                      <Textarea
                        value={editing.text}
                        autoFocus
                        className="min-h-16 text-[13px]"
                        aria-label="编辑排队消息"
                        onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                        onKeyDown={(event) => event.stopPropagation()}
                      />
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={clearing || !editing.text.trim()}
                          onClick={async () => {
                            if (await onEdit(editing.message, editing.text)) setEditing(undefined)
                          }}
                        >
                          保存
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={clearing}
                          onClick={() => setEditing(undefined)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="truncate">{message.text}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-start gap-0.5">
                  {!message.steer && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label="用这条消息调整当前任务"
                      title="在下一个可调整节点发送给当前任务"
                      disabled={clearing || !!editing}
                      onClick={() => onSteer(message)}
                    >
                      <CornerDownRightIcon />
                      Steer
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="上移排队消息"
                    title="上移"
                    disabled={clearing || message.index === 0 || !!editing}
                    onClick={() => onMove(message, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="下移排队消息"
                    title="下移"
                    disabled={
                      clearing || message.index === message.expected.length - 1 || !!editing
                    }
                    onClick={() => onMove(message, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="编辑排队消息"
                    title="编辑"
                    disabled={clearing || !!editing}
                    onClick={() => setEditing({ message, text: message.text })}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="删除排队消息"
                    title="删除"
                    disabled={clearing || !!editing}
                    onClick={() => onRemove(message)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          {queued.length > 3 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-faint-foreground mt-1 text-[11px]"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起' : `还有 ${queued.length - 3} 条…`}
            </Button>
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
