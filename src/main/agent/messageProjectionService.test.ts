import { expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'

import type { AgentMessageRepo } from '../db/repositories/agentMessageRepo'
import { MessageProjectionService } from './messageProjectionService'

test('replaces the product message projection from the authoritative Pi transcript', async () => {
  const repo = { replaceBySession: vi.fn() } as unknown as AgentMessageRepo
  const service = new MessageProjectionService(repo)

  await service.project('session-1', [
    { role: 'user', content: 'Hello', timestamp: 10 },
    { role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: 20 },
    {
      role: 'toolResult',
      toolCallId: 'tool-1',
      toolName: 'read',
      content: [],
      isError: false,
      timestamp: 30,
    },
  ])

  expect(repo.replaceBySession).toHaveBeenCalledWith('session-1', [
    {
      id: messageId({ role: 'user', content: 'Hello', timestamp: 10 }),
      sessionId: 'session-1',
      parentId: null,
      role: 'user',
      createdAt: 10,
      payload: { role: 'user', content: 'Hello', timestamp: 10 },
    },
    {
      id: messageId({ role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: 20 }),
      sessionId: 'session-1',
      parentId: messageId({ role: 'user', content: 'Hello', timestamp: 10 }),
      role: 'assistant',
      createdAt: 20,
      payload: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: 20 },
    },
  ])
})

test('keeps message ids stable when non-chat transcript entries are inserted', async () => {
  const repo = { replaceBySession: vi.fn() } as unknown as AgentMessageRepo
  const service = new MessageProjectionService(repo)
  const messages = [
    { role: 'user' as const, content: 'Hello', timestamp: 10 },
    { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Hi' }], timestamp: 20 },
  ]

  await service.project('session-1', messages)
  const firstIds = vi.mocked(repo.replaceBySession).mock.calls[0]![1].map(({ id }) => id)
  await service.project('session-1', [
    { role: 'custom', customType: 'note', content: '', timestamp: 5 },
    ...messages,
  ])
  const secondIds = vi.mocked(repo.replaceBySession).mock.calls[1]![1].map(({ id }) => id)

  expect(secondIds).toEqual(firstIds)
})

function messageId(message: unknown): string {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(message))
    .digest('hex')
    .slice(0, 24)
  return `pi-msg:${fingerprint}:0`
}
