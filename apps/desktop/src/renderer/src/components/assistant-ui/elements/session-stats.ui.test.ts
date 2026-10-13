import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  threadListItem: { id: 'first' },
  thread: { isLoading: false, isRunning: false, messages: [] as Array<{ role: string; status: { type: string }; content: Array<{ type: string; text: string }> }> },
  messages: [] as Array<{ role: string }>,
  pending: false,
}))
vi.mock('@assistant-ui/react', () => ({ useAuiState: (select: (value: typeof state) => unknown) => select(state) }))
vi.mock('../../../features/chat/runtime/SendState', () => ({ usePendingSend: () => state.pending }))
vi.mock('../../../features/chat/runtime/chat-runtime', () => ({ useChatThreadState: (select: (value: unknown) => unknown) => select({ state: { messages: state.messages } }) }))
vi.mock('@kklyeenook/ui/assistant-ui/session-stats', () => ({
  SessionStats: ({ ready, messages, children }: { ready: boolean; messages: unknown[]; children: ReactNode }) => ready ? createElement('div', { 'data-count': messages.length }, children) : null,
}))
import { SessionStats } from './session-stats.aui'

test('keeps completed statistics through later sends and refreshes after the reply', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  const reply = { role: 'assistant', status: { type: 'complete' }, content: [{ type: 'text', text: 'Reply' }] }
  const render = async (context: string) => act(async () => { root.render(createElement(SessionStats, null, context)) })
  try {
    await render('first context')
    expect(container.textContent).toBe('')
    state.thread.isRunning = true
    state.messages = [{ role: 'user' }]
    await render('first context')
    expect(container.textContent).toBe('')
    state.thread.isRunning = false
    state.thread.messages = [reply]
    state.messages = [{ role: 'user' }, { role: 'assistant' }]
    await render('10%')
    expect(container.textContent).toBe('10%')
    state.pending = true
    state.thread.messages = [reply, { role: 'user', status: { type: 'complete' }, content: [] }]
    state.messages = [...state.messages, { role: 'user' }]
    await render('11%')
    expect(container.textContent).toBe('10%')
    expect(container.firstElementChild?.getAttribute('data-count')).toBe('2')
    state.pending = false
    state.thread.isRunning = true
    await render('15%')
    expect(container.textContent).toBe('10%')
    state.thread.isRunning = false
    state.thread.messages = [...state.thread.messages, reply]
    state.messages = [...state.messages, { role: 'assistant' }]
    await render('20%')
    expect(container.textContent).toBe('20%')
    expect(container.firstElementChild?.getAttribute('data-count')).toBe('4')
    state.threadListItem.id = 'empty'
    state.thread.messages = []
    state.messages = []
    await render('empty')
    expect(container.textContent).toBe('')
    state.threadListItem.id = 'existing-running'
    state.thread.messages = [reply]
    state.thread.isRunning = true
    state.messages = [{ role: 'user' }, { role: 'assistant' }]
    await render('existing context')
    expect(container.textContent).toBe('existing context')
  } finally {
    await act(async () => root.unmount())
  }
})
