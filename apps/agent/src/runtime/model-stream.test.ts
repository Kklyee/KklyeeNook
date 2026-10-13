import { afterEach, expect, test, vi } from 'vitest'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { Api, Model } from '@earendil-works/pi-ai'
import { limitModelStream, MODEL_IDLE_TIMEOUT, MODEL_REQUEST_TIMEOUT } from './model-stream'

const model: Model<Api> = {
  id: 'test', name: 'Test', provider: 'custom', api: 'openai-completions', baseUrl: 'http://localhost',
  reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

afterEach(() => vi.useRealTimers())

test('a silent provider is aborted and settles with a visible idle error', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const source = new AssistantMessageEventStream()
  const stream = limitModelStream(model, (current) => { signal = current; return source })
  await vi.advanceTimersByTimeAsync(MODEL_IDLE_TIMEOUT)
  expect(signal?.aborted).toBe(true)
  expect(await stream.result()).toMatchObject({ stopReason: 'error', errorMessage: expect.stringContaining('5 分钟') })
  expect(vi.getTimerCount()).toBe(0)
})

test('idle timeout preserves partial text and thinking instead of losing progress', async () => {
  vi.useFakeTimers()
  const source = new AssistantMessageEventStream()
  const stream = limitModelStream(model, () => source)
  const partial = fauxAssistantMessage([{ type: 'text', text: 'working' }, { type: 'thinking', thinking: 'partial' }])
  source.push({ type: 'start', partial })
  await vi.advanceTimersByTimeAsync(60_000)
  source.push({ type: 'text_delta', contentIndex: 0, delta: 'working', partial })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(vi.getTimerCount()).toBe(2)
  await vi.advanceTimersByTimeAsync(MODEL_IDLE_TIMEOUT - 60_000)
  expect((await stream.result()).content).toEqual(partial.content)
  expect(vi.getTimerCount()).toBe(0)
})

test('continuously streaming responses still stop at the total request limit', async () => {
  vi.useFakeTimers()
  const source = new AssistantMessageEventStream()
  const stream = limitModelStream(model, () => source)
  const partial = fauxAssistantMessage([{ type: 'thinking', thinking: 'working' }])
  for (let elapsed = 0; elapsed < MODEL_REQUEST_TIMEOUT - 60_000; elapsed += 60_000) {
    source.push({ type: 'thinking_delta', contentIndex: 0, delta: 'working', partial })
    await vi.advanceTimersByTimeAsync(60_000)
  }
  source.push({ type: 'thinking_delta', contentIndex: 0, delta: 'working', partial })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(await stream.result()).toMatchObject({ stopReason: 'error', errorMessage: expect.stringContaining('10 分钟') })
  expect(vi.getTimerCount()).toBe(0)
})

test('successful completion forwards the message and clears all timers', async () => {
  vi.useFakeTimers()
  const source = new AssistantMessageEventStream()
  const stream = limitModelStream(model, () => source)
  const message = fauxAssistantMessage([{ type: 'text', text: 'done' }])
  source.push({ type: 'done', reason: 'stop', message })
  expect(await stream.result()).toEqual(message)
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(0)
})

test('a normal response may wait longer than 90 seconds before returning', async () => {
  vi.useFakeTimers()
  const source = new AssistantMessageEventStream()
  let signal: AbortSignal | undefined
  const stream = limitModelStream(model, (current) => { signal = current; return source })
  await vi.advanceTimersByTimeAsync(240_000)
  expect(signal?.aborted).toBe(false)
  const message = fauxAssistantMessage('reply')
  source.push({ type: 'done', reason: 'stop', message })
  expect(await stream.result()).toEqual(message)
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(0)
})

test('tool execution after a model response is outside the model timeout', async () => {
  vi.useFakeTimers()
  const source = new AssistantMessageEventStream()
  let signal: AbortSignal | undefined
  const stream = limitModelStream(model, (current) => { signal = current; return source })
  const message = fauxAssistantMessage('')
  message.content = [{ type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'long check' } }]
  message.stopReason = 'toolUse'
  source.push({ type: 'done', reason: 'toolUse', message })
  expect(await stream.result()).toEqual(message)
  await vi.advanceTimersByTimeAsync(MODEL_REQUEST_TIMEOUT + 1)
  expect(signal?.aborted).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

test('user cancellation remains cancellation and does not become a timeout', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const source = new AssistantMessageEventStream()
  const stream = limitModelStream(model, () => source, controller.signal)
  controller.abort(new Error('cancelled'))
  expect(await stream.result()).toMatchObject({ stopReason: 'aborted', errorMessage: 'cancelled' })
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(0)
})

test('an already cancelled request never starts the provider', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const start = vi.fn(() => new AssistantMessageEventStream())
  const stream = limitModelStream(model, start, controller.signal)
  expect(await stream.result()).toMatchObject({ stopReason: 'aborted' })
  expect(start).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
