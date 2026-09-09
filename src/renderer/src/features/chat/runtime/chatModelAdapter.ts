import type { ChatModelAdapter, ToolCallMessagePart } from '@assistant-ui/react'
import type { ChatMessage, ChatStreamEvent } from '@/shared/chat/chatEvent'

type SessionResolver = () => Promise<string>

export function createChatModelAdapter(resolveSessionId: SessionResolver): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const sessionId = await resolveSessionId()
      if (!sessionId) {
        throw new Error('Missing thread session ID')
      }

      abortSignal.throwIfAborted()

      const serializedMessages: ChatMessage[] = []
      const contentParts: Array<{ type: 'text'; text: string } | ToolCallMessagePart> = []
      const toolCallIndices = new Map<string, number>()

      for (const message of messages) {
        if (message.role !== 'user' && message.role !== 'assistant') {
          continue
        }

        const text = message.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('\n')

        if (text) {
          serializedMessages.push({ role: message.role, content: text })
        }
      }

      let stop: (() => void) | undefined
      let removeAbortListener: (() => void) | undefined

      const stream = new ReadableStream<ChatStreamEvent>({
        start(controller) {
          let settled = false

          const close = () => {
            if (settled) return
            settled = true
            controller.close()
          }

          const fail = (error: unknown) => {
            if (settled) return
            settled = true
            controller.error(error)
          }

          stop = window.api.streamChat({ messages: serializedMessages, sessionId }, (event) => {
            switch (event.type) {
              case 'done':
                close()
                break
              case 'error':
                fail(new Error(event.message))
                break
              case 'aborted':
                close()
                break
              default:
                controller.enqueue(event)
                break
            }
          })

          const onAbort = () => {
            stop?.()
            fail(abortSignal.reason)
          }

          abortSignal.addEventListener('abort', onAbort, { once: true })
          removeAbortListener = () => abortSignal.removeEventListener('abort', onAbort)

          if (abortSignal.aborted) {
            onAbort()
          }
        },

        cancel() {
          stop?.()
        },
      })

      const reader = stream.getReader()

      try {
        while (true) {
          const { done, value: event } = await reader.read()
          if (done) return

          switch (event.type) {
            case 'delta': {
              const lastPart = contentParts.at(-1)
              if (lastPart?.type === 'text') {
                contentParts[contentParts.length - 1] = {
                  ...lastPart,
                  text: lastPart.text + event.text,
                }
              } else {
                contentParts.push({ type: 'text', text: event.text })
              }
              break
            }
            case 'tool_start': {
              const argsText = JSON.stringify(event.args ?? {}) ?? '{}'
              toolCallIndices.set(event.toolCallId, contentParts.length)
              contentParts.push({
                type: 'tool-call',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: JSON.parse(argsText),
                argsText,
              })
              break
            }
            case 'tool_end': {
              const index = toolCallIndices.get(event.toolCallId)
              const toolCall = index === undefined ? undefined : contentParts[index]
              if (index !== undefined && toolCall?.type === 'tool-call') {
                contentParts[index] = {
                  ...toolCall,
                  result: event.result,
                  isError: !event.success,
                }
              }
              break
            }
            case 'tool_update':
            case 'aborted':
            case 'done':
            case 'error':
              continue
          }

          yield { content: [...contentParts] }
        }
      } finally {
        removeAbortListener?.()
        stop?.()
        reader.releaseLock()
      }
    },
  }
}
