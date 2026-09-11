import { expect, test, vi } from 'vitest'

import type { AgentMessageRepo } from '../db/repositories/agentMessageRepo'
import { MessageProjectionService } from './messageProjectionService'

test('replaces the product message projection from the authoritative Pi transcript', async () => {
  const repo = { replaceBySession: vi.fn() } as unknown as AgentMessageRepo
  const service = new MessageProjectionService(repo)

  await service.project('session-1', [
    { role: 'user', content: 'Hello', timestamp: 10 },
    { role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: 20 },
    { role: 'toolResult', toolCallId: 'tool-1', toolName: 'read', content: [], isError: false, timestamp: 30 },
  ])

  expect(repo.replaceBySession).toHaveBeenCalledWith('session-1', [
    {
      id: 'pi-msg:0',
      sessionId: 'session-1',
      parentId: null,
      role: 'user',
      createdAt: 10,
      payload: { role: 'user', content: 'Hello', timestamp: 10 },
    },
    {
      id: 'pi-msg:1',
      sessionId: 'session-1',
      parentId: 'pi-msg:0',
      role: 'assistant',
      createdAt: 20,
      payload: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: 20 },
    },
  ])
})
