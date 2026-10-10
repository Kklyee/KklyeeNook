import { useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useChatRuntimeExtras, useChatRuntimeSnapshot } from './chat-runtime'

export function ApprovalPrompt() {
  const current = useChatRuntimeSnapshot().current
  const request = current.approvals[0]
  const { respondToApproval, continueThread } = useChatRuntimeExtras()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  if (current.historical) return (
    <div className="material-control mx-auto flex items-center gap-3 rounded-2xl p-3">
      <p className="text-sm text-muted-foreground">历史会话只读，继续将创建独立的新会话。</p>
      <Button size="sm" disabled={pending} onClick={() => {
        setPending(true)
        void continueThread().catch((error) => setError(String(error))).finally(() => setPending(false))
      }}>继续为新会话</Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
  if (!request) return null
  const answer = async (approved: boolean) => {
    setPending(true)
    setError(undefined)
    try {
      await respondToApproval(request.id, approved)
    } catch (error) {
      setError(error instanceof Error ? error.message : '审批失败，请重试')
    } finally {
      setPending(false)
    }
  }
  return (
    <div role="region" aria-live="polite" aria-label="执行审批" className="material-control mx-auto flex w-full max-w-(--thread-max-width) flex-wrap items-center gap-3 rounded-2xl p-3">
      <div className="min-w-0 flex-1 break-words text-sm">
        <p className="font-medium">{request.toolName}</p>
        <p>{request.reason}</p>
        <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(request.arguments)}</pre>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <Button size="sm" disabled={pending} onClick={() => void answer(true)}>允许一次</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void answer(false)}>拒绝</Button>
    </div>
  )
}
