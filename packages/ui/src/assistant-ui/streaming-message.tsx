import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useAui, useAuiEvent, useAuiState } from '@assistant-ui/react'

const StreamingMessageContext = createContext({ live: false, fresh: false, initialPartCount: 0 })
const StreamingTextContext = createContext(false)
const StreamingThreadContext = createContext<{
  current: { threadId?: string; history: Set<string> | null }
} | null>(null)

export function StreamingThread({ children }: { children: ReactNode }) {
  const aui = useAui()
  const threadId = useAuiState((state) => state.threads.mainThreadId)
  const tracking = useRef({ threadId, history: null as Set<string> | null })
  if (tracking.current.threadId !== threadId) tracking.current = { threadId, history: null }
  useAuiEvent('thread.runStart', () => {
    tracking.current.history = new Set(aui.thread.getState().messages.map((message) => message.id))
  })
  return (
    <StreamingThreadContext.Provider value={tracking}>{children}</StreamingThreadContext.Provider>
  )
}

export function StreamingMessage({ children }: { children: ReactNode }) {
  const active = useAuiState((state) => state.message.isLast && state.thread.isRunning)
  const id = useAuiState((state) => state.message.id)
  const isLast = useAuiState((state) => state.message.isLast)
  const tracking = useContext(StreamingThreadContext)
  const aui = useAui()
  const initialPartCount = useRef(aui.message.getState().content.length).current
  const fresh = useRef(isLast && !!tracking?.current.history && !tracking.current.history.has(id)).current
  const live = useRef(active || fresh)
  if (active) live.current = true
  const value = useMemo(
    () => ({ live: live.current, fresh, initialPartCount }),
    [active, fresh, initialPartCount],
  )
  return (
    <StreamingMessageContext.Provider value={value}>{children}</StreamingMessageContext.Provider>
  )
}

export function StreamingText({
  indices,
  children,
}: {
  indices: readonly number[]
  children: ReactNode
}) {
  const scope = useContext(StreamingMessageContext)
  const live =
    scope.live && (scope.fresh || indices.some((index) => index >= scope.initialPartCount))
  return <StreamingTextContext.Provider value={live}>{children}</StreamingTextContext.Provider>
}

export const useStreamingMessage = () => useContext(StreamingTextContext)
