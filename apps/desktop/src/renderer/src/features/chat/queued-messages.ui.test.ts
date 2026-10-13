import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { QueuedMessages } from './QueuedMessages'

const mocks = vi.hoisted(() => ({ updateQueue: vi.fn(async () => {}), refresh: vi.fn(async () => {}) }))
vi.mock('./runtime/chat-runtime', () => ({ useChatRuntimeExtras: () => ({
  queue: { steering: [], followUp: ['Text\n[image]'] },
  queueItems: [{ id: 77, mode: 'followUp' }],
  updateQueue: mocks.updateQueue, refresh: mocks.refresh,
}) }))
vi.mock('@/renderer/src/components/assistant-ui/elements/message-queue', () => ({
  MessageQueue: ({ queued, onRemove }: { queued: { id: string }[]; onRemove: (message: { id: string }) => void }) =>
    createElement('button', { onClick: () => onRemove(queued[0]) }, 'Delete'),
}))

test('deleting an image queue message sends its stable submission ID', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(() => root.render(createElement(QueuedMessages)))
    await act(() => element.querySelector('button')!.click())
    expect(mocks.updateQueue).toHaveBeenCalledWith({
      itemId: '77', mode: 'followUp', expected: ['Text\n[image]'], index: 0, action: 'remove',
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
  } finally {
    await act(() => root.unmount())
    element.remove()
  }
})
