import type { ReactNode } from 'react'
import { useChatThreadState } from '../../../features/chat/runtime/chat-runtime'
import { SessionStats as SharedSessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'

export function SessionStats({ children }: { children?: ReactNode }) {
  const messages = useChatThreadState((state) => state.state.messages)
  return <SharedSessionStats messages={messages}>{children}</SharedSessionStats>
}
