import { expect, test } from 'vitest'

import { ApprovalService } from './approvalService'
import type { PermissionDescriptor } from '@/shared/approval/approvalTypes'

const permission: PermissionDescriptor = {
  toolName: 'write',
  action: 'filesystem.write',
  resourceKind: 'path',
  resource: '/project/hello.txt',
  recursive: false,
  description: '修改文件 /project/hello.txt',
}

test('resolves an approval request after the user responds', async () => {
  const approvalService = new ApprovalService()
  const resultPromise = approvalService.request({
    id: 'test-1',
    toolCallId: 'call-1',
    sessionId: 'session-1',
    toolName: 'write',
    args: { path: 'hello.txt', content: 'hello' },
    permission,
  })

  approvalService.respond({ id: 'test-1', decision: 'allow_session' })

  await expect(resultPromise).resolves.toBe('allow_session')
})
