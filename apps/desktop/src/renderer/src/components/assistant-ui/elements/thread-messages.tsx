import { useLayoutEffect, type ComponentProps } from 'react'
import {
  ThreadPrimitive,
  unstable_useThreadMessageIds,
  useThreadViewport,
  useAuiState,
} from '@assistant-ui/react'
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { scrollPositions } from '@kklyeenook/ui/assistant-ui/scroll-position'
import { useScrollFollower } from './thread-scroll-follower'

const measurements = new Map<string, VirtualItem[]>()

export function ThreadMessages({
  components,
}: {
  components: ComponentProps<typeof ThreadPrimitive.Unstable_MessageById>['components']
}) {
  const { scrollToMessage, following, resume } = useScrollFollower()
  const viewport = useThreadViewport((state) => state.element.viewport)
  const ids = unstable_useThreadMessageIds()
  const threadId = useAuiState((state) => state.threads.mainThreadId)
  const virtualizer = useVirtualizer({
    count: ids.length,
    initialMeasurementsCache: measurements.get(threadId),
    initialOffset: scrollPositions.get(threadId)?.top,
    getScrollElement: () => viewport,
    estimateSize: () => 240,
    getItemKey: (index) => ids[index]!,
    anchorTo: following ? 'start' : 'end',
    followOnAppend: false,
    overscan: 4,
    gap: 24,
  })
  useLayoutEffect(() => () => {
    const snapshot = virtualizer.takeSnapshot()
    if (snapshot.length) measurements.set(threadId, snapshot)
  }, [threadId, virtualizer])
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
