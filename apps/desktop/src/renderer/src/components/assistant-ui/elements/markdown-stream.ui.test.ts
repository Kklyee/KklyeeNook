import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime } from '@assistant-ui/react'
import { MarkdownText } from '@kklyeenook/ui/assistant-ui/markdown-text'
import { StreamingMessage, StreamingText, StreamingThread } from '@kklyeenook/ui/assistant-ui/streaming-message'

function Text() {
  const layout = useAuiState(state => state.message.metadata.custom?.layout as string)
  return createElement(MarkdownText, { key: layout })
}

function Message() {
  return createElement(StreamingMessage, null,
    createElement(StreamingText, { indices: [0], children: createElement(MessagePrimitive.Parts, { components: { Text } }) }),
  )
}

function App({ text, complete = false }: { text: string; complete?: boolean }) {
  const runtime = useExternalStoreRuntime({
    messages: [{ id: 'reply', role: 'assistant' as const, content: text ? [{ type: 'text' as const, text }] : [], metadata: { custom: { layout: complete ? 'final' : 'process' } }, status: complete ? { type: 'complete' as const, reason: 'stop' as const } : { type: 'running' as const } }],
    convertMessage: message => message,
    isRunning: !complete,
    onNew: async () => {},
  })
  return createElement(AssistantRuntimeProvider, { runtime },
    createElement(StreamingThread, { children: createElement(ThreadPrimitive.Root, null, createElement(ThreadPrimitive.Messages, { components: { Message } })) }),
  )
}

test('streamed text remains visible when the final reply renderer remounts', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(() => root.render(createElement(App, { text: '' })))
    await act(() => root.render(createElement(App, { text: 'First half' })))
    await act(() => new Promise(resolve => setTimeout(resolve, 300)))
    expect(element.textContent).toBe('First half')
    await act(() => root.render(createElement(App, { text: 'First half and the rest' })))
    await act(() => new Promise(resolve => setTimeout(resolve, 300)))
    expect(element.textContent).toBe('First half and the rest')
    await act(() => root.render(createElement(App, { text: 'First half and the rest', complete: true })))
    expect(element.textContent).toBe('First half and the rest')
  } finally {
    await act(() => root.unmount())
    element.remove()
  }
})
