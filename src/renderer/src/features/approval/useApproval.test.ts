import { expect, test } from 'vitest'

import type { ApprovalRequest } from '@/shared/approval/approvalTypes'
import { normalizeApprovalRequests } from './useApproval'

test('normalizes approval state retained by Fast Refresh', () => {
  const legacyRequest = {
    id: 'approval-1',
    toolCallId: 'call-1',
    sessionId: 'session-1',
    toolName: 'read',
  } as ApprovalRequest

  expect(normalizeApprovalRequests(null)).toEqual([])
  expect(normalizeApprovalRequests(legacyRequest)).toEqual([legacyRequest])
  expect(normalizeApprovalRequests([legacyRequest])).toEqual([legacyRequest])
})
