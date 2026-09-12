import { expect, test, vi } from 'vitest'

import type { ApprovalPolicy } from './approvalPolicy'
import { createPiApprovalExtension } from './piApprovalExtension'

const permission = {
  toolName: 'read',
  action: 'filesystem.read',
  resourceKind: 'path' as const,
  resource: 'D:/project',
  recursive: true,
  description: 'Read project files',
}

function setup(selection: string | undefined) {
  let handler: ((event: any, context: any) => Promise<unknown>) | undefined
  const policy = {
    evaluate: vi.fn(() => Promise.resolve({ outcome: 'prompt', permission })),
    grant: vi.fn(() => Promise.resolve({})),
  } as unknown as ApprovalPolicy
  const emit = vi.fn()
  const extension = createPiApprovalExtension('session-1', policy, emit)
  extension({ on: (_name: string, callback: typeof handler) => (handler = callback) } as never)
  const execute = () =>
    handler!(
      { toolCallId: 'tool-1', toolName: 'read', input: { path: 'README.md' } },
      { ui: { select: vi.fn(() => Promise.resolve(selection)) } },
    )
  return { execute, policy, emit }
}

test('persists a tool-level session approval selected through Pi host UI', async () => {
  const { execute, policy, emit } = setup('Allow this tool for this session')

  await expect(execute()).resolves.toBeUndefined()
  expect(policy.grant).toHaveBeenCalledWith('session', 'session-1', permission)
  expect(emit).toHaveBeenLastCalledWith({
    type: 'approval_resolved',
    approvalId: 'tool-1',
    toolCallId: 'tool-1',
    decision: 'allow',
  })
})

test('blocks a tool when Pi host UI denies or dismisses the approval', async () => {
  const { execute, policy, emit } = setup(undefined)

  await expect(execute()).resolves.toEqual({ block: true, reason: 'User denied tool execution' })
  expect(policy.grant).not.toHaveBeenCalled()
  expect(emit).toHaveBeenLastCalledWith({
    type: 'approval_resolved',
    approvalId: 'tool-1',
    toolCallId: 'tool-1',
    decision: 'deny',
  })
})
