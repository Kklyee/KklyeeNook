import { expect, test } from 'vitest'
import type { PiAssistantMessage } from '@assistant-ui/react-pi'
import { remoteMessage } from './remoteState'

test('preserves assistant usage and tool calls for remote session statistics', () => {
  const message: PiAssistantMessage = {
    role: 'assistant',
    timestamp: 2,
    api: 'openai-completions',
    provider: 'test',
    model: 'test',
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} }],
    usage: {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      totalTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
  for (const streaming of [false, true]) {
    expect(remoteMessage(message, streaming)).toMatchObject({
      usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
      content: [{ type: 'data', name: 'tool-call', data: { toolCallId: 'tool-1' } }],
      status: streaming ? 'running' : 'complete',
    })
  }
})
