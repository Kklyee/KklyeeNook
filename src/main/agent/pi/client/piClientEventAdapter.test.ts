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
  }

  expect(
    toPiClientEventBody(
      {
        type: 'message_update',
        message: assistantMessage as never,
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'hello',
          partial: assistantMessage as never,
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

  const thinkingMessage = {
    ...assistantMessage,
    content: [{ type: 'thinking', thinking: 'working it out' }],
  } as never
  expect(
    toPiClientEventBody(
      {
        type: 'message_update',
        message: thinkingMessage,
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: 'working it out',
          partial: thinkingMessage,
        },
      },
      0,
    ),
  ).toMatchObject({
    type: 'message_update',
    message: {
      content: [{ type: 'thinking', thinking: 'working it out' }],
    },
    assistantMessageEvent: { type: 'thinking_delta', delta: 'working it out' },
  })
})
