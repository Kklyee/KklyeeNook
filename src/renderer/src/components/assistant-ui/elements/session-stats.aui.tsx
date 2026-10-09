import type { ReactNode } from 'react'
import { usePiThreadState } from '@assistant-ui/react-pi'
import { SessionStats as SharedSessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'

export function SessionStats({ children }: { children?: ReactNode }) {
  const messages = usePiThreadState((state) => state.messages)
  return <SharedSessionStats messages={messages}>{children}</SharedSessionStats>
}
