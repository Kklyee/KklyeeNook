import { useEffect, useState, type ReactNode } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { usePendingSend } from '../../../features/chat/runtime/SendState'
import { useChatThreadState } from '../../../features/chat/runtime/chat-runtime'
import { SessionStats as SharedSessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'

export function SessionStats({ children }: { children?: ReactNode }) {
  const messages = useChatThreadState((state) => state.state.messages)
  const pending = usePendingSend()
  const threadId = useAuiState((state) => state.threadListItem.id)
  const [completed, setCompleted] = useState<{
    threadId: string
    messages: typeof messages
    children: ReactNode
  }>()
  const ready = useAuiState((state) => {
    const last = state.thread.messages.at(-1)
    return !state.thread.isLoading && !state.thread.isRunning &&
      last?.role === 'assistant' && last.status.type === 'complete' &&
      last.content.some((part) => part.type === 'text' && part.text.trim().length > 0)
  }) && !pending
  const hasHistory = useAuiState((state) => state.thread.messages.some((message) =>
    message.role === 'assistant' && message.status.type === 'complete' &&
    message.content.some((part) => part.type === 'text' && part.text.trim().length > 0),
  ))
  const previous = completed?.threadId === threadId ? completed : undefined
  const hasPrevious = !!previous
  useEffect(() => {
    if (ready || (!hasPrevious && hasHistory)) setCompleted({ threadId, messages, children })
  }, [ready, hasHistory, hasPrevious, threadId, messages, children])
  const current = ready || (!previous && hasHistory)
  return (
    <SharedSessionStats messages={current ? messages : previous?.messages ?? []} ready={current || !!previous}>
      {current ? children : previous?.children}
    </SharedSessionStats>
  )
}
