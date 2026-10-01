import { expect, test, vi } from 'vitest'
import { createPiApprovalExtension } from './piApprovalExtension'

test('adds the permission mode to the prompt and leaves tool interception to the harness', () => {
  const on = vi.fn()
  createPiApprovalExtension({ conversationId: 'chat', mode: 'read-only' })({ on } as never)
  expect(on.mock.calls.map(([name]) => name)).toEqual(['before_agent_start'])
  const prompt = on.mock.calls[0][1]({
    systemPrompt: 'Prompt\nCurrent working directory: private\n',
  })
  expect(prompt.systemPrompt).toContain('Current permission mode: read-only')
  expect(prompt.systemPrompt).not.toContain('Current working directory')
})
