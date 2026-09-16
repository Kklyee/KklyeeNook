import { expect, test, vi } from 'vitest'

import type { AgentBackendProcess } from './process'
import { createBackendPiClient } from './piClientProxy'

test('forwards IPC Pi commands and subscriptions through the backend process', async () => {
  const unsubscribe = vi.fn()
  const backend = {
    request: vi.fn().mockResolvedValue(undefined),
    subscribePi: vi.fn(() => unsubscribe),
  } as unknown as AgentBackendProcess
  const client = createBackendPiClient(backend)

  await client.sendMessage('thread-1', { content: 'hello' }, ['attachment-1'])
  expect(backend.request).toHaveBeenCalledWith({
    action: 'pi:call',
    call: {
      method: 'sendMessage',
      args: ['thread-1', { content: 'hello' }, ['attachment-1']],
    },
  })

  const listener = vi.fn()
  expect(client.subscribe('thread-1', listener, { includeSnapshot: false })).toBe(unsubscribe)
  expect(backend.subscribePi).toHaveBeenCalledWith(
    { threadId: 'thread-1', options: { includeSnapshot: false } },
    listener,
  )
})
