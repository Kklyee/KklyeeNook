import type { ReactNode } from 'react'

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  AuiConfig,
  Tools,
  Suggestions,
  type ChatModelAdapter,
  type ToolCallMessagePart,
} from '@assistant-ui/react'

import type { ChatMessage, ChatStreamEvent } from '@/shared/chat/chatEvent'
import { piToolkit } from '../tools/ToolKit'

const ipcChatModel: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    abortSignal.throwIfAborted()

    // assistant-ui Message -> 应用自定义 ChatMessage
    const serializedMessages: ChatMessage[] = []
    const contentParts: Array<{ type: 'text'; text: string } | ToolCallMessagePart> = []
    const toolCallIndices = new Map<string, number>()

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
          }
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
            const toolCallIndex = toolCallIndices.get(event.toolCallId)
            const toolCall = toolCallIndex === undefined ? undefined : contentParts[toolCallIndex]

            if (toolCallIndex !== undefined && toolCall?.type === 'tool-call') {
              contentParts[toolCallIndex] = {
                ...toolCall,
                result: event.result,
                isError: !event.success,
              }
            }
            break
          }

          case 'tool_update':
            continue

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

export function AssistantRuntime({ children }: { children: ReactNode }) {
  const runtime = useLocalRuntime(ipcChatModel)
  const config = AuiConfig({
    tools: Tools({ toolkit: piToolkit }),
    suggestions: Suggestions([
      { title: '了解项目', label: '', prompt: '请阅读当前项目，介绍目录结构和主要模块，暂时不要修改文件。' },
      { title: '解释代码', label: '', prompt: '请解释当前项目中 Agent 从接收消息到完成回复的流程，暂时不要修改文件。' },
      { title: '整理文档', label: '', prompt: '请阅读项目并提出 README 的改进建议，等我确认后再修改。' },
    ]),
  })

  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      {children}
    </AssistantRuntimeProvider>
  )
}
