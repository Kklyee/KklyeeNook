import { createHash } from 'node:crypto'
import type { AssistantMessage, Message, ProviderStreams, StreamFunction } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'

export function compatibleToolNames(provider: ProviderStreams): ProviderStreams {
  const wrap = (stream: StreamFunction): StreamFunction => (model, context, options) => {
    const names = new Set<string>()
    for (const message of context.messages) {
      if (message.role === 'system') for (const tool of [...(message.toolsAdded ?? []), ...(message.toolsRemoved ?? [])]) names.add(tool.name)
      if (message.role === 'assistant') for (const part of message.content) if (part.type === 'toolCall') names.add(part.name)
      if (message.role === 'toolResult') names.add(message.toolName)
    }
    const encoded = new Map<string, string>()
    const decoded = new Map<string, string>()
    const used = new Set(names)
    for (const name of [...names].sort()) {
      if (/^[a-zA-Z0-9_-]{1,64}$/.test(name)) continue
      const hash = createHash('sha256').update(name).digest('hex').slice(0, 16)
      const base = `${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}_${hash}`
      let alias = base
      for (let index = 1; used.has(alias); index++) alias = `${base}_${index}`
      used.add(alias)
      encoded.set(name, alias)
      decoded.set(alias, name)
    }
    if (!encoded.size) return stream(model, context, options)
    const encode = (name: string) => encoded.get(name) ?? name
    const decode = (name: string) => decoded.get(name) ?? name
    const restore = (message: AssistantMessage): AssistantMessage => ({
      ...message,
      content: message.content.map((part) => part.type === 'toolCall' ? { ...part, name: decode(part.name) } : part),
    })
    const messages = context.messages.map((message): Message => {
      if (message.role === 'system') return {
        ...message,
        toolsAdded: message.toolsAdded?.map((tool) => ({ ...tool, name: encode(tool.name) })),
        toolsRemoved: message.toolsRemoved?.map((tool) => ({ ...tool, name: encode(tool.name) })),
      }
      if (message.role === 'assistant') return {
        ...message,
        content: message.content.map((part) => part.type === 'toolCall' ? { ...part, name: encode(part.name) } : part),
      }
      if (message.role === 'toolResult') return { ...message, toolName: encode(message.toolName) }
      return message
    })
    const source = stream(model, { ...context, messages }, options)
    const output = createAssistantMessageEventStream()
    void (async () => {
      try {
        for await (const event of source) {
          if (event.type === 'done') output.push({ ...event, message: restore(event.message) })
          else if (event.type === 'error') output.push({ ...event, error: restore(event.error) })
          else if (event.type === 'toolcall_end') output.push({ ...event, partial: restore(event.partial), toolCall: { ...event.toolCall, name: decode(event.toolCall.name) } })
          else output.push({ ...event, partial: restore(event.partial) })
        }
        output.end(restore(await source.result()))
      } catch (error) {
        output.push({ type: 'error', reason: 'error', error: {
          role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'error', errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now(),
        } })
      }
    })()
    return output
  }
  return { ...provider, stream: wrap(provider.stream.bind(provider)), streamSimple: wrap(provider.streamSimple.bind(provider)) }
}
