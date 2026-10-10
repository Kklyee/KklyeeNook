import { expect, test } from 'vitest'
import type { AssistantMessage } from 'pi-ai-legacy'
import { convertPiEvent } from './piEventAdapter'

const message: AssistantMessage = {
  role: 'assistant',
  content: [],
  api: 'openai-responses',
  provider: 'openai',
  model: 'model',
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'toolUse',
  timestamp: 100,
}

test('projects inference boundaries for every assistant cycle and ignores user and tool messages', () => {
  expect(convertPiEvent({ type: 'message_start', message })).toEqual({ type: 'inference_started' })
  expect(convertPiEvent({ type: 'message_end', message })).toEqual({
    type: 'inference_finished',
    failed: false,
  })
  expect(
    convertPiEvent({ type: 'message_end', message: { ...message, stopReason: 'error' } }),
  ).toEqual({ type: 'inference_finished', failed: true })
  expect(
    convertPiEvent({ type: 'message_end', message: { ...message, stopReason: 'aborted' } }),
  ).toEqual({ type: 'inference_finished', failed: true })
  expect(
    convertPiEvent({
      type: 'message_start',
      message: { role: 'user', content: 'Task', timestamp: 50 },
    }),
  ).toBeUndefined()
  expect(
    convertPiEvent({
      type: 'message_start',
      message: {
        role: 'toolResult',
        toolCallId: 'tool',
        toolName: 'read',
        content: [],
        isError: false,
        timestamp: 200,
      },
    }),
  ).toBeUndefined()
})
