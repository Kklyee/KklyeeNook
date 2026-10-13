import { useLayoutEffect, type ComponentProps } from 'react'
import {
  ThreadPrimitive,
  unstable_useThreadMessageIds,
  useThreadViewport,
} from '@assistant-ui/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useScrollFollower } from './thread-scroll-follower'

export function ThreadMessages({
  components,
}: {
  components: ComponentProps<typeof ThreadPrimitive.Unstable_MessageById>['components']
}) {
  const { scrollToMessage, following, resume } = useScrollFollower()
  const viewport = useThreadViewport((state) => state.element.viewport)
  const ids = unstable_useThreadMessageIds()
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => viewport,
    estimateSize: () => 240,
    getItemKey: (index) => ids[index]!,
    anchorTo: following ? 'start' : 'end',
    followOnAppend: false,
    overscan: 4,
    gap: 24,
  })
  const size = virtualizer.getTotalSize()
  useLayoutEffect(() => {
    if (following) resume()
  }, [size, following, resume])
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = following ? () => false : undefined
  useLayoutEffect(() => {
    scrollToMessage.current = (id) => {
      const index = ids.indexOf(id)
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'start' })
    }
    return () => {
      scrollToMessage.current = null
    }
  }, [ids, virtualizer, scrollToMessage])
  return (
    <div className="relative w-full shrink-0" style={{ height: size }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          ref={virtualizer.measureElement}
          data-index={item.index}
          className="absolute top-0 left-0 w-full"
          style={{ transform: `translateY(${item.start}px)` }}
        >
          <ThreadPrimitive.Unstable_MessageById
            messageId={ids[item.index]!}
            components={components}
          />
        </div>
      ))}
    </div>
  )
}
