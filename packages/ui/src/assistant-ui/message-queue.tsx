import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import {
  CheckIcon,
  CornerDownRightIcon,
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { Button } from '../components/button'
import { Textarea } from '../components/textarea'
import { cn } from '../lib/utils'

export interface QueuedMessage {
  id: string
  text: string
  steer: boolean
  index: number
  expected: string[]
}

const HOLD_MS = 240
const SLOP_PX = 8

type DragSession = {
  message: QueuedMessage
  lane: readonly string[]
  order: string[]
  from: number
  y: number
  active: boolean
  timer?: ReturnType<typeof setTimeout>
}

export function MessageQueue({
  queued,
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
  onRemove: (message: QueuedMessage) => void
  onSteer: (message: QueuedMessage) => void
  onEdit: (message: QueuedMessage, text: string) => Promise<boolean>
  onMove: (message: QueuedMessage, offset: number) => void
  clearing: boolean
  error?: string
}) {
  const visible = queued.length > 0
  const [editing, setEditing] = useState<{ message: QueuedMessage; text: string }>()
  const [drag, setDrag] = useState<{ id: string; ids: readonly string[] }>()
  const session = useRef<DragSession | undefined>(undefined)
  const listRef = useRef<HTMLOListElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  const endDrag = () => {
    if (session.current?.timer) clearTimeout(session.current.timer)
    session.current = undefined
    setDrag(undefined)
  }
  useEffect(
    () => () => {
      if (session.current?.timer) clearTimeout(session.current.timer)
    },
    [],
  )
  useEffect(() => {
    if (!visible) setEditing(undefined)
  }, [visible])
  useLayoutEffect(() => {
    const content = contentRef.current!
    const observer = new ResizeObserver(() => setHeight(content.getBoundingClientRect().height))
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const save = async () => {
    if (!editing?.text.trim()) return
    if (await onEdit(editing.message, editing.text)) setEditing(undefined)
  }
  const rows = drag ? orderRows(queued, drag.ids) : queued

  return (
    <div
      data-slot="message-queue"
      className={cn(
        'overflow-hidden transition-[height,opacity,transform] duration-150 motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-0.5 opacity-0',
        className,
      )}
      aria-hidden={!visible}
      inert={!visible}
      {...props}
      style={{ ...props.style, height: visible ? height : 0 }}
    >
      <div ref={contentRef} className="flow-root">
        <section
          className="message-queue-surface bg-surface-opaque border-border mx-3 rounded-t-xl border border-b-0 px-2 py-1"
          aria-label="待执行消息"
        >
          <ol
            ref={listRef}
            className="text-muted-foreground flex max-h-60 flex-col gap-0.5 overflow-y-auto text-[13px]"
          >
            {rows.map((message) => (
              <li
                key={message.id}
                data-queue-id={message.id}
                data-queue-index={message.index}
                data-queue-lane={String(message.steer)}
                tabIndex={0}
                aria-label={message.text}
                className={cn(
                  'group/queue flex min-w-0 items-center gap-1 rounded-md border-s-2 py-0.5 pe-0.5 ps-1 text-[13px] outline-none select-none focus-visible:ring-1 focus-visible:ring-ring',
                  message.steer ? 'border-s-brand' : 'border-s-transparent',
                  drag?.id === message.id && 'opacity-50',
                )}
                onPointerDown={(event) => {
                  if (event.button !== 0 || clearing || editing) return
                  if ((event.target as HTMLElement).closest('button, textarea, input')) return
                  endDrag()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const grip = !!(event.target as HTMLElement).closest('[data-slot="queue-grip"]')
                  const start: DragSession = {
                    message,
                    lane: queued
                      .filter((item) => item.steer === message.steer)
                      .map((item) => item.id),
                    order: queued.map((item) => item.id),
                    from: message.index,
                    y: event.clientY,
                    active: grip,
                  }
                  if (grip) setDrag({ id: message.id, ids: start.order })
                  else
                    start.timer = setTimeout(() => {
                      start.active = true
                      setDrag({ id: start.message.id, ids: start.order })
                    }, HOLD_MS)
                  session.current = start
                }}
                onPointerMove={(event) => {
                  const active = session.current
                  if (!active) return
                  if (!active.active) {
                    if (Math.abs(event.clientY - active.y) > SLOP_PX) endDrag()
                    return
                  }
                  event.preventDefault()
                  const next = moveLane(
                    active.order,
                    active.lane,
                    active.message.id,
                    dropIndex(listRef.current, active.message.steer, event.clientY),
                  )
                  if (next === active.order) return
                  active.order = next
                  setDrag({ id: active.message.id, ids: next })
                }}
                onPointerUp={() => {
                  const active = session.current
                  if (active?.active) {
                    const to = active.order
                      .filter((id) => active.lane.includes(id))
                      .indexOf(active.message.id)
                    if (to >= 0 && to !== active.from) onMove(active.message, to - active.from)
                  }
                  endDrag()
                }}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || !event.altKey || clearing || editing)
                    return
                  const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
                  if (
                    !offset ||
                    message.index + offset < 0 ||
                    message.index + offset >= message.expected.length
                  )
                    return
                  event.preventDefault()
                  onMove(message, offset)
                }}
              >
                <span
                  data-slot="queue-grip"
                  className="text-faint-foreground -ms-0.5 flex size-4 shrink-0 cursor-grab touch-none items-center justify-center opacity-0 transition-opacity group-hover/queue:opacity-100 group-focus-visible/queue:opacity-100"
                >
                  <GripVerticalIcon className="size-3" />
                </span>
                {editing?.message.id === message.id ? (
                  <div className="min-w-0 flex-1 py-0.5">
                    <Textarea
                      value={editing.text}
                      autoFocus
                      className="min-h-16 text-[13px]"
                      aria-label="编辑待执行消息"
                      onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setEditing(undefined)
                        } else if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void save()
                        }
                      }}
                    />
                    <div className="mt-1 flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="保存"
                        title="保存"
                        disabled={clearing || !editing.text.trim()}
                        onClick={() => void save()}
                      >
                        <CheckIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="取消编辑"
                        title="取消"
                        disabled={clearing}
                        onClick={() => setEditing(undefined)}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 truncate" title={message.text}>
                      {message.text}
                    </p>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {!message.steer && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-faint-foreground hover:text-foreground"
                          aria-label="引导当前任务"
                          title="引导当前任务"
                          disabled={clearing}
                          onClick={() => onSteer(message)}
                        >
                          <CornerDownRightIcon />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-faint-foreground hover:text-foreground"
                        aria-label="编辑"
                        title="编辑"
                        disabled={clearing}
                        onClick={() => setEditing({ message, text: message.text })}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-faint-foreground hover:text-foreground"
                        aria-label="删除"
                        title="删除"
                        disabled={clearing}
                        onClick={() => onRemove(message)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
          {error && (
            <p role="alert" className="text-destructive mt-1 text-[11px]">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function orderRows(queued: readonly QueuedMessage[], ids: readonly string[]) {
  const byId = new Map(queued.map((message) => [message.id, message]))
  const rows = ids.flatMap((id) => byId.get(id) ?? [])
  const ordered = new Set(rows.map((message) => message.id))
  return [...rows, ...queued.filter((message) => !ordered.has(message.id))]
}

function dropIndex(list: HTMLOListElement | null, steer: boolean, y: number) {
  const rows = list?.querySelectorAll<HTMLElement>(`[data-queue-lane="${steer}"]`)
  if (!rows) return 0
  for (let index = 0; index < rows.length; index++) {
    const rect = rows[index]!.getBoundingClientRect()
    if (y < rect.top + rect.height / 2) return index
  }
  return rows.length
}

function moveLane(order: string[], lane: readonly string[], id: string, target: number) {
  const ids = order.filter((item) => lane.includes(item))
  const from = ids.indexOf(id)
  if (from < 0) return order
  const to = Math.max(0, Math.min(ids.length - 1, target > from ? target - 1 : target))
  if (to === from) return order
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  let cursor = 0
  return order.map((item) => (lane.includes(item) ? ids[cursor++]! : item))
}
