import { useCallback, useEffect, useState } from 'react'

import type { ApprovalRequest, ApprovalResponse } from '@/shared/approval/approvalTypes'

type ApprovalQueueState = ApprovalRequest[] | ApprovalRequest | null | undefined

export function normalizeApprovalRequests(value: ApprovalQueueState): ApprovalRequest[] {
  if (Array.isArray(value)) return value
  return value && typeof value.id === 'string' ? [value] : []
}

export function useApproval() {
  const [requests, setRequests] = useState<ApprovalQueueState>([])
  const request = normalizeApprovalRequests(requests)[0] ?? null

  useEffect(() => {
    return window.api.onApprovalRequested((request) => {
      setRequests((current) =>
        normalizeApprovalRequests(current).some((candidate) => candidate.id === request.id)
          ? current
          : [...normalizeApprovalRequests(current), request],
      )
    })
  }, [])

  const respond = useCallback(
    (decision: ApprovalResponse['decision']) => {
      if (!request) {
        return
      }

      window.api.respondApproval({ id: request.id, decision })
      setRequests((current) =>
        normalizeApprovalRequests(current).filter((candidate) => candidate.id !== request.id),
      )
    },
    [request],
  )

  return {
    request,
    respond,
    clear() {
      setRequests((current) => normalizeApprovalRequests(current).slice(1))
    },
  }
}
