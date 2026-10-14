import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createContext } from 'react'
import { expect, test, vi } from 'vitest'
import { App } from './app'
import type { RemoteConversationSnapshot } from '@kklyeenook/shared/remote/index'

const mocks = vi.hoisted(() => ({ cache: new Map(), load: vi.fn() }))
vi.mock('./api', () => ({
  conversationSnapshots: mocks.cache, loadConversation: mocks.load,
  cacheConversation: (id: string, snapshot: unknown) => mocks.cache.set(id, snapshot),
  api: async () => ({ models: [], permissions: [], defaults: { provider: 'test', modelId: 'model', thinkingLevel: 'off', permission: 'read-only' } }),
}))
vi.mock('./bot-provider', () => ({ BotProvider: ({ children }: { children: ReactNode }) => children, useBots: () => ({ bots: [], reload: async () => {}, options: { workspaces: [] } }) }))
vi.mock('./navigation', () => ({ Navigation: () => null, NavigationContext: createContext(() => {}) }))
vi.mock('./Controls', () => ({ Controls: () => null }))
vi.mock('./bot-pages', () => ({ BotsPage: () => null, BotMainPage: () => null, EditBotPage: () => null }))
vi.mock('./remote-thread', () => ({ RemoteThread: ({ loading, messages }: { loading: boolean; messages: Array<{ content: Array<{ text?: string }> }> }) => createElement('div', { 'data-loading': String(loading) }, messages.flatMap((message) => message.content.map((part) => part.text ?? '')).join('')) }))

const snapshot = (text: string): RemoteConversationSnapshot => ({
  id: 'chat', projectId: '', title: 'Chat', updatedAt: 1, status: 'idle', permission: 'read-only', thinkingLevel: 'off',
  messages: [{ id: 'reply', role: 'assistant', timestamp: 1, content: [{ type: 'text', text }], status: 'complete' }], queue: [], activities: [], approvals: [],
})

test('late initial loading cannot replace a live snapshot, and reconnect accepts the new stream sequence', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.cache.clear()
  let resolveLoad!: (value: RemoteConversationSnapshot) => void
  mocks.load.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve }))
  const sources: Array<EventTarget & { onopen?: () => void }> = []
  class Source extends EventTarget {
    onopen?: () => void
    onerror?: () => void
    close() {}
    constructor() { super(); sources.push(this) }
  }
  vi.stubGlobal('EventSource', Source)
  location.hash = '/bots/coder/conversations/chat'
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const emit = (seq: number, text: string) => sources.at(-1)!.dispatchEvent(new MessageEvent('remote', { data: JSON.stringify({ type: 'snapshot', seq, snapshot: snapshot(text) }) }))
  try {
    await act(async () => { root.render(createElement(App)); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(element.querySelector('[data-loading="true"]')).not.toBeNull()
    await act(() => { sources.at(-1)!.onopen?.(); emit(5, 'Live reply') })
    expect(element.textContent).toContain('Live reply')
    await act(async () => resolveLoad(snapshot('Old reply')))
    expect(element.textContent).not.toContain('Old reply')
    await act(() => { emit(4, 'Outdated frame') })
    expect(element.textContent).not.toContain('Outdated frame')
    await act(() => { sources.at(-1)!.onopen?.(); emit(1, 'Reconnected reply') })
    expect(element.textContent).toContain('Reconnected reply')
    expect(element.querySelector('[data-loading="false"]')).not.toBeNull()
  } finally {
    await act(() => root.unmount())
    element.remove()
    vi.unstubAllGlobals()
    mocks.cache.clear()
  }
})
