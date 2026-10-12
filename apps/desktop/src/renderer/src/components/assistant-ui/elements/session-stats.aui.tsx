import type { ReactNode } from 'react'
import {
  useChatThreadState,
  useChatRuntimeSnapshot,
} from '../../../features/chat/runtime/chat-runtime'
import { useAuiState } from '@assistant-ui/react'
import { usePendingSend } from '../../../features/chat/runtime/SendState'
import { SessionStats as SharedSessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'

export function SessionStats({ children, status }: { children?: ReactNode; status?: string }) {
  const messages = useChatThreadState((state) => state.state.messages)
  const running = useAuiState((state) => state.thread.isRunning)
  const pending = usePendingSend()
  const { current } = useChatRuntimeSnapshot()
  const label =
    status ??
    (pending
      ? '正在发送…'
      : current.approvals.some((approval) => approval.state === 'pending')
        ? '等待审批'
        : running
          ? '正在执行…'
          : current.loading
            ? '正在加载…'
            : undefined)
  return (
    <SharedSessionStats messages={messages} status={label}>
      {children}
    </SharedSessionStats>
  )
}
