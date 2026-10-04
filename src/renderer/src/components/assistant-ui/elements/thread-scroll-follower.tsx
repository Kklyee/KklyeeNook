import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { ThreadPrimitive, useAuiEvent } from '@assistant-ui/react'

const ScrollFollowerContext = createContext({ following: true, resume: () => {} })

export function useScrollFollower() {
  return useContext(ScrollFollowerContext)
}

export function ThreadScrollViewport({
  children,
  ...props
}: ComponentProps<typeof ThreadPrimitive.Viewport> & { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const scheduleRef = useRef(() => {})
  const [following, setFollowing] = useState(true)
  const resume = useCallback(() => {
    followRef.current = true
    setFollowing(true)
    scheduleRef.current()
  }, [])

  useAuiEvent('threads.selectionChanged', resume)
  useAuiEvent('thread.initialize', resume)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let target = 0
    let lastTop = viewport.scrollTop
    let lastBottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    let touchY = 0
    const pause = () => {
      followRef.current = false
      setFollowing(false)
      cancelAnimationFrame(frame)
      frame = 0
    }
    const tick = () => {
      frame = 0
      if (!followRef.current) return
      const before = viewport.scrollTop
      const diff = target - before
      viewport.scrollTop =
        reducedMotion.matches || Math.abs(diff) < 0.5 ? target : before + diff * 0.18
      if (viewport.scrollTop === before && diff !== 0) viewport.scrollTop = target
      lastTop = viewport.scrollTop
      lastBottom = target
      if (Math.abs(target - lastTop) >= 0.5) frame = requestAnimationFrame(tick)
    }
    const schedule = () => {
      target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (followRef.current && !frame) frame = requestAnimationFrame(tick)
    }
    const scroll = () => {
      const top = viewport.scrollTop
      const bottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (top < lastTop - 1 && bottom >= lastBottom) {
        pause()
      } else if (
        !followRef.current &&
        top > lastTop &&
        viewport.scrollHeight - viewport.clientHeight - top <= 80
      ) {
        resume()
      }
      lastTop = top
      lastBottom = bottom
    }
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) pause()
    }
    const touchStart = (event: TouchEvent) => {
      touchY = event.touches[0].clientY
    }
    const touchMove = (event: TouchEvent) => {
      const nextY = event.touches[0].clientY
      if (nextY > touchY) pause()
      touchY = nextY
    }
    const keyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if (
        ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
        (event.key === ' ' && event.shiftKey)
      )
        pause()
    }
    scheduleRef.current = schedule
    const observer = new ResizeObserver(schedule)
    observer.observe(content)
    observer.observe(viewport)
    viewport.addEventListener('scroll', scroll, { passive: true })
    viewport.addEventListener('wheel', wheel, { passive: true })
    viewport.addEventListener('touchstart', touchStart, { passive: true })
    viewport.addEventListener('touchmove', touchMove, { passive: true })
    viewport.addEventListener('keydown', keyDown)
    reducedMotion.addEventListener('change', schedule)
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      scheduleRef.current = () => {}
      viewport.removeEventListener('scroll', scroll)
      viewport.removeEventListener('wheel', wheel)
      viewport.removeEventListener('touchstart', touchStart)
      viewport.removeEventListener('touchmove', touchMove)
      viewport.removeEventListener('keydown', keyDown)
      reducedMotion.removeEventListener('change', schedule)
    }
  }, [resume])

  return (
    <ScrollFollowerContext.Provider value={{ following, resume }}>
      <ThreadPrimitive.Viewport
        {...props}
        ref={viewportRef}
        autoScroll={false}
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
      >
        <div ref={contentRef} className="flex min-h-full shrink-0 flex-col">
          {children}
        </div>
      </ThreadPrimitive.Viewport>
    </ScrollFollowerContext.Provider>
  )
}
