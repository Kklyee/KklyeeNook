import { expect, test, vi } from 'vitest'
import { SandboxService } from '../sandbox/sandboxService'
import { createPiApprovalExtension } from './piApprovalExtension'

function setup(selection?: string) {
  let handler: ((event: any, context: any) => Promise<unknown>) | undefined
  const sandbox = new SandboxService()
  const emit = vi.fn()
  const select = vi.fn(async (_title: string, _options: string[]) => selection)
  const extension = createPiApprovalExtension(
    {
      conversationId: 'session-1',
      workspace: { id: 'ws', rootPath: process.cwd() },
      mode: 'workspace-write',
    },
    sandbox,
    emit,
  )
  extension({
    on: (name: string, callback: typeof handler) => {
      if (name === 'tool_call') handler = callback
    },
  } as never)
  const input = { command: 'npm install' }
  const execute = () =>
    handler!({ toolCallId: 'tool-1', toolName: 'bash', input }, { ui: { select } })
  return { execute, sandbox, emit, select }
}

test('offers only one-shot elevation and denial when the shell sandbox is unavailable', async () => {
  const { execute, emit, select } = setup('允许一次')
  await expect(execute()).resolves.toBeUndefined()
  expect(select.mock.calls[0][1]).toEqual(['允许一次', '拒绝'])
  expect(emit).toHaveBeenLastCalledWith({
    type: 'approval_resolved',
    approvalId: 'tool-1',
    toolCallId: 'tool-1',
    decision: 'allow',
  })
})

test('blocks a denied or dismissed approval', async () => {
  await expect(setup().execute()).resolves.toMatchObject({ block: true })
})
