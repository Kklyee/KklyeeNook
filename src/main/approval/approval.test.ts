import { expect, test } from 'vitest'

import { ApprovalService } from './approvalService'

test('resolves an approval request after the user responds', async () => {
  const approvalService = new ApprovalService()
  const resultPromise = approvalService.request({
    id: 'test-1',
    toolCallId: 'call-1',
    toolName: 'write',
    args: { path: 'hello.txt', content: 'hello' },
  })

  approvalService.respond({ id: 'test-1', decision: 'allow' })

  await expect(resultPromise).resolves.toBe(true)
})
