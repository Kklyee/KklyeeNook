import type { Api, AssistantMessage, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { Provider } from '@earendil-works/pi-ai/models'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'

export const MODEL_REQUEST_TIMEOUT = 600_000
export const MODEL_IDLE_TIMEOUT = 300_000

export function limitModelStream(
  model: Model<Api>,
  start: (signal: AbortSignal) => AssistantMessageEventStream,
  signal?: AbortSignal,
  thinkingLevel?: ModelThinkingLevel,
) {
  const output = new AssistantMessageEventStream()
  const controller = new AbortController()
  let partial: AssistantMessage = {
    role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'pending', timestamp: Date.now(), thinkingLevel,
  }
  let timedOut = false
  const timeout = (message: string) => {
    timedOut = true
    controller.abort(new Error(message))
  }
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const totalTimer = setTimeout(() => timeout('模型请求超过 10 分钟，已停止本次请求。'), MODEL_REQUEST_TIMEOUT)
  let idleTimer = setTimeout(() => timeout('模型连续 5 分钟没有返回数据，已停止本次请求。'), MODEL_IDLE_TIMEOUT)
  void (async () => {
    let rejectAbort: () => void = () => {}
    try {
      controller.signal.throwIfAborted()
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', rejectAbort, { once: true })
        if (controller.signal.aborted) rejectAbort()
      })
      const source = start(controller.signal)
      const iterator = source[Symbol.asyncIterator]()
      while (true) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next.done) {
          output.end(await Promise.race([source.result(), aborted]))
          return
        }
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => timeout('模型连续 5 分钟没有返回数据，已停止本次请求。'), MODEL_IDLE_TIMEOUT)
        const event = next.value
        if (thinkingLevel !== undefined) {
          const message = event.type === 'done' ? event.message : event.type === 'error' ? event.error : event.partial
          message.thinkingLevel = thinkingLevel
        }
        if (event.type === 'done' || event.type === 'error') {
          output.push(event)
          output.end()
          return
        }
        partial = event.partial
        output.push(event)
      }
    } catch (error) {
      const reason = timedOut ? 'error' : controller.signal.aborted ? 'aborted' : 'error'
      output.push({ type: 'error', reason, error: { ...partial, stopReason: reason, errorMessage: error instanceof Error ? error.message : String(error) } })
      output.end()
    } finally {
      clearTimeout(totalTimer)
      clearTimeout(idleTimer)
      signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', rejectAbort)
    }
  })()
  return output
}

export function limitModelProvider(provider: Provider): Provider {
  return {
    ...provider,
    stream: (model, context, options) => limitModelStream(model, (signal) => provider.stream(model, context, { ...options, signal } as NonNullable<typeof options>), options?.signal),
    streamSimple: (model, context, options) => limitModelStream(model, (signal) => provider.streamSimple(model, context, { ...options, signal }), options?.signal, options?.reasoning ?? 'off'),
  }
}
