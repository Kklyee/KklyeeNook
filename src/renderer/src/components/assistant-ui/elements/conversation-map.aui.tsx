import { useEffect, useMemo, useState } from 'react'
import { useAuiState, useThreadViewport } from '@assistant-ui/react'
import { ConversationMap } from './conversation-map'
import { useScrollFollower } from './thread-scroll-follower'

export function ConversationMapAui() {
  const messages = useAuiState((state) => state.thread.messages)
  const viewport = useThreadViewport((state) => state.element.viewport)
  const height = useThreadViewport((state) => state.height.viewport)
  const { pause } = useScrollFollower()
  const [activeId, setActiveId] = useState<string>()
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const entries = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'user')
        .map((message) => {
          const text = message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join(' ')
            .trim()
          return {
            id: message.id,
            createdAt: message.createdAt,
            title:
              text.slice(0, 72) ||
              message.attachments?.map((file) => file.name).join('、') ||
              '附件消息',
            preview: text.length > 72 ? text.slice(72, 312) : undefined,
          }
        }),
    [messages],
  )
  const messageIds = messages.map((message) => message.id).join(' ')
  const userIds = entries.map((entry) => entry.id).join(' ')

  useEffect(() => {
    if (!viewport) return
    let frame = 0
    const measure = () => {
      frame = 0
      const view = viewport.getBoundingClientRect()
      const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      const line =
        view.top +
        view.height * Math.min(1, Math.max(0, 1 - remaining / Math.max(1, viewport.clientHeight))) +
        1
      let current: string | undefined
      const visible: string[] = []
      for (const element of viewport.querySelectorAll<HTMLElement>(
        '[data-role="user"][data-message-id]',
      )) {
        const box = element.getBoundingClientRect()
        const id = element.dataset.messageId!
        if (box.top <= line) current = id
        if (box.bottom > view.top && box.top < view.bottom) visible.push(id)
      }
      setActiveId(current ?? userIds.split(' ')[0])
      setVisibleIds((previous) => (previous.join(' ') === visible.join(' ') ? previous : visible))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    observer.observe(viewport.firstElementChild!)
    viewport.addEventListener('scroll', schedule, { passive: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      viewport.removeEventListener('scroll', schedule)
    }
  }, [viewport, messageIds, userIds])

  if (entries.length < 2) return null

  return (
    <div className="pointer-events-none sticky top-0 z-20 h-0 w-full">
      <div
        className="pointer-events-auto absolute top-0 py-10"
        style={{ height, right: 'max(1.5rem, calc((100% - var(--thread-max-width)) / 2 - 2rem))' }}
      >
        <ConversationMap
          aria-label="定位用户消息"
          entries={entries}
          activeId={activeId}
          visibleIds={visibleIds}
          side="left"
          onSelect={(id) => {
            const target = Array.from(
              viewport!.querySelectorAll<HTMLElement>('[data-message-id]'),
            ).find((element) => element.dataset.messageId === id)
            if (!target) return
            pause()
            viewport!.scrollTo({
              top:
                target.getBoundingClientRect().top -
                viewport!.getBoundingClientRect().top +
                viewport!.scrollTop -
                16,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
            })
          }}
        />
      </div>
    </div>
  )
}
