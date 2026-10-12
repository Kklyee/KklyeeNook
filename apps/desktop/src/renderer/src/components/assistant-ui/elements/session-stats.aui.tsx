import type { ReactNode } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { usePendingSend } from '../../../features/chat/runtime/SendState'
import { useChatThreadState } from '../../../features/chat/runtime/chat-runtime'
import { SessionStats as SharedSessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'

export function SessionStats({ children }: { children?: ReactNode }) {
  const messages = useChatThreadState((state) => state.state.messages)
  const pending = usePendingSend()
  const ready = useAuiState((state) => {
    const last = state.thread.messages.at(-1)
    return !state.thread.isLoading && !state.thread.isRunning &&
      last?.role === 'assistant' && last.status.type === 'complete' &&
      last.content.some((part) => part.type === 'text' && part.text.trim().length > 0)
  }) && !pending
  return (
    <SharedSessionStats messages={messages} ready={ready}>
      {children}
    </SharedSessionStats>
  )
}
