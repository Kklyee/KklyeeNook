import { useCallback, useEffect, useState } from 'react'

import type { ApprovalRequest, ApprovalResponse } from '@/shared/approval/approvalTypes'

export function useApproval() {
  const [request, setRequest] = useState<ApprovalRequest | null>(null)

  useEffect(() => {
    return window.api.onApprovalRequested((request) => {
      setRequest(request)
    })
  }, [])

  const respond = useCallback(
    (decision: ApprovalResponse['decision']) => {
      if (!request) {
        return
      }

      window.api.respondApproval({ id: request.id, decision })
      setRequest(null)
    },
    [request],
  )

  return {
    request,
    respond,
    clear() {
      setRequest(null)
    },
  }
}
