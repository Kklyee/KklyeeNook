import type { ReactNode } from 'react'

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ToolCallMessagePart,
} from '@assistant-ui/react'

import type { ChatMessage, ChatStreamEvent } from '@/shared/chat/chatEvent'

const ipcChatModel: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    abortSignal.throwIfAborted()

    // assistant-ui Message -> 应用自定义 ChatMessage
    const serializedMessages: ChatMessage[] = []
    let fullText = ''
    const toolCalls = new Map<string, ToolCallMessagePart>()

    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') {
        continue
      }

      const text = message.content
        .flatMap((part) => {
          if (part.type === 'text') {
            return [part.text]
          }

          return []
        })
        .join('\n')

      if (!text) continue

      serializedMessages.push({ role: message.role, content: text })
    }

    // callback stream -> ReadableStream
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

        stop = window.api.streamChat(
          { messages: serializedMessages },

          (event) => {
            switch (event.type) {
              case 'done':
                close()
                break

              case 'error':
                fail(new Error(event.message))
                break

              default:
                controller.enqueue(event)
                break
            }
          },
        )

        const onAbort = () => {
          stop?.()
          fail(abortSignal.reason)
        }

        abortSignal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => {
          abortSignal.removeEventListener('abort', onAbort)
        }

        if (abortSignal.aborted) {
          onAbort()
        }
      },

      cancel() {
        stop?.()
      },
    })

    // assistant-ui 要求：yield 的不是 delta，而是完整累计文本
    const reader = stream.getReader()

    try {
      while (true) {
        const { done, value: event } = await reader.read()

        if (done) {
          return
        }

        switch (event.type) {
          case 'delta':
            fullText += event.text
            break

          case 'tool_start': {
            const argsText = JSON.stringify(event.args ?? {}) ?? '{}'

            toolCalls.set(event.toolCallId, {
              type: 'tool-call',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: JSON.parse(argsText),
              argsText,
            })
            break
          }

          case 'tool_end': {
            const toolCall = toolCalls.get(event.toolCallId)

            if (toolCall) {
              toolCalls.set(event.toolCallId, {
                ...toolCall,
                result: event.result,
                isError: !event.success,
              })
            }
            break
          }

          case 'tool_update':
            continue

          case 'done':
          case 'error':
            continue
        }

        yield {
          content: [
            ...(fullText ? [{ type: 'text' as const, text: fullText }] : []),

            ...Array.from(toolCalls.values()),
          ],
        }
      }
    } finally {
      removeAbortListener?.()
      stop?.()

      reader.releaseLock()
    }
  },
}

export function AssistantRuntime({ children }: { children: ReactNode }) {
  const runtime = useLocalRuntime(ipcChatModel)

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
