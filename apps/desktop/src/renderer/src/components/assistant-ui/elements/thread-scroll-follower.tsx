import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import { ThreadPrimitive, useAui, useAuiEvent, useAuiState } from '@assistant-ui/react'

import { scrollPositions } from '@kklyeenook/ui/assistant-ui/scroll-position'
import type { ChatExtras } from '@/renderer/src/features/chat/runtime/chat-store'

const ScrollFollowerContext = createContext<{ following: boolean; resume(): void; pause(): void; scrollToMessage: RefObject<((id: string) => void) | null> }>({ following: true, resume: () => {}, pause: () => {}, scrollToMessage: { current: null } })

export function useScrollFollower() {
  return useContext(ScrollFollowerContext)
}

export function ThreadScrollViewport({
  children,
  contentReady = true,
  ...props
}: ComponentProps<typeof ThreadPrimitive.Viewport> & { children: ReactNode; contentReady?: boolean }) {
  const aui = useAui()
  const [historyError, setHistoryError] = useState<string>()
  const loadOlder = useRef(() => {})
  const scrollToMessage = useRef<((id: string) => void) | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const threadId = useAuiState((state) => state.threads.mainThreadId)
  const savedPosition = scrollPositions.get(threadId)
  const followRef = useRef(savedPosition?.following ?? true)
  const initialized = useRef(false)
  const smoothRef = useRef(false)
  const initializeRef = useRef(() => {})
  const pauseRef = useRef(() => {})
  const isLoading = useAuiState((state) => state.thread.isLoading)
  const hasMessages = useAuiState((state) => state.thread.messages.length > 0)
  const pause = useCallback(() => pauseRef.current(), [])
  const [following, setFollowing] = useState(savedPosition?.following ?? true)
  const resume = useCallback(() => {
    initializeRef.current()
  }, [])

  useAuiEvent('thread.runStart', () => {
    smoothRef.current = true
  })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let target = 0
    let lastTop = viewport.scrollTop
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
      if (Math.abs(target - lastTop) >= 0.5) frame = requestAnimationFrame(tick)
    }
    const schedule = () => {
      target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (followRef.current && !frame) frame = requestAnimationFrame(tick)
    }
    const snapToBottom = () => {
      cancelAnimationFrame(frame)
      frame = 0
      target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      viewport.scrollTop = target
      lastTop = viewport.scrollTop
    }
    const initialize = () => {
      followRef.current = true
      setFollowing(true)
      snapToBottom()
    }
    const resize = () => {
      if (!followRef.current) return
      if (smoothRef.current) schedule()
      else snapToBottom()
    }
    const scroll = () => {
      if (initialized.current) scrollPositions.set(threadId, { top: viewport.scrollTop, following: followRef.current })
      if (!followRef.current && viewport.scrollTop <= 120) loadOlder.current()
      const top = viewport.scrollTop
      if (
        !followRef.current &&
        top > lastTop &&
        viewport.scrollHeight - viewport.clientHeight - top <= 80
      ) {
        resume()
      }
      lastTop = top
    }
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) { pause(); if (viewport.scrollTop <= 120) loadOlder.current() }
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
    initializeRef.current = initialize
    pauseRef.current = pause
    const observer = new ResizeObserver(resize)
    observer.observe(content)
    observer.observe(viewport)
    const mutations = new MutationObserver(resize)
    mutations.observe(content, { subtree: true, childList: true, characterData: true, attributes: true })
    viewport.addEventListener('scroll', scroll, { passive: true })
    viewport.addEventListener('wheel', wheel, { passive: true })
    viewport.addEventListener('touchstart', touchStart, { passive: true })
    viewport.addEventListener('touchmove', touchMove, { passive: true })
    viewport.addEventListener('keydown', keyDown)
    reducedMotion.addEventListener('change', schedule)
    return () => {
      if (initialized.current) scrollPositions.set(threadId, { top: viewport.scrollTop, following: followRef.current })
      initialized.current = false
      observer.disconnect()
      mutations.disconnect()
      cancelAnimationFrame(frame)
      initializeRef.current = () => {}
      pauseRef.current = () => {}
      viewport.removeEventListener('scroll', scroll)
      viewport.removeEventListener('wheel', wheel)
      viewport.removeEventListener('touchstart', touchStart)
      viewport.removeEventListener('touchmove', touchMove)
      viewport.removeEventListener('keydown', keyDown)
      reducedMotion.removeEventListener('change', schedule)
    }
  }, [resume, threadId])

  useLayoutEffect(() => {
    smoothRef.current = false
  }, [threadId, isLoading])

  useLayoutEffect(() => {
    if (isLoading || !contentReady || initialized.current) return
    initialized.current = true
    const saved = scrollPositions.get(threadId)
    if (saved && !saved.following && viewportRef.current) {
      followRef.current = false
      setFollowing(false)
      viewportRef.current.scrollTop = saved.top
    } else initializeRef.current()
  }, [threadId, isLoading, hasMessages, contentReady])

  loadOlder.current = () => {
    const extras = aui.thread.getState().extras as ChatExtras | undefined
    if (!extras?.history?.hasMore || extras.history.loading) return
    setHistoryError(undefined)
    void extras.loadOlder().catch(() => setHistoryError('历史加载失败，请向上滚动重试'))
  }

  return (
    <ScrollFollowerContext.Provider value={{ following, resume, pause, scrollToMessage }}>
      <ThreadPrimitive.Viewport
        {...props}
        ref={viewportRef}
        autoScroll={false}
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
      >
        <div ref={contentRef} className="flex min-h-full shrink-0 flex-col">
          {historyError && <div role="status" className="text-muted-foreground py-2 text-center text-xs">{historyError}</div>}
          {children}
        </div>
      </ThreadPrimitive.Viewport>
    </ScrollFollowerContext.Provider>
  )
}
