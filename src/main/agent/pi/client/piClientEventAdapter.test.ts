import { expect, test } from 'vitest'

import { toPiClientEventBody } from './piClientEventAdapter'

test('preserves Pi text and tool events for react-pi', () => {
  const assistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 1,
  } as never

  expect(
    toPiClientEventBody(
      {
        type: 'message_update',
        message: assistantMessage,
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'hello',
          partial: assistantMessage,
        },
      },
      0,
    ),
  ).toMatchObject({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
  })
  expect(
    toPiClientEventBody(
      {
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'read',
        args: { path: 'README.md' },
      },
      0,
    ),
  ).toEqual({
    type: 'tool_execution_start',
    toolCallId: 'tool-1',
    toolName: 'read',
    args: { path: 'README.md' },
  })
})
