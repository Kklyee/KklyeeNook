import { act, createElement } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { RemoteThread } from './remote-thread'
import { scrollPositions } from '@kklyeenook/ui/assistant-ui/scroll-position'
import type { RemoteMessage } from '@kklyeenook/shared/remote/index'

vi.mock('@kklyeenook/ui/assistant-ui/markdown-text', () => ({ MarkdownText: () => {
  return useAuiState((state: any) => state.part.text)
} }))

test('remote keeps final reply and file changes visible while completed execution is collapsed', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } })
  const message: RemoteMessage = {
    id: 'reply', role: 'assistant', timestamp: 9000, status: 'complete', stepCount: 2,
    content: [{ type: 'text', text: 'Checking files' }, { type: 'text', text: 'Fixed the issue' }],
    execution: { startedAt: 1000, endedAt: 11000, finalPartIndex: 1 },
    model: { provider: 'test', model: 'model', thinkingLevel: 'high' },
    fileChanges: [{ path: 'file.ts', operation: 'modified', additions: 1 }],
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const render = (running: boolean) => root.render(createElement(RemoteThread, {
    messages: [{ ...message, status: running ? 'running' : 'complete' }], running, busy: false, disabled: false,
    controls: null, onSend: async () => {}, pendingSteer: [{ id: '42', text: 'Correction', steer: true, index: 0, expected: [] }], queue: createElement('div', { 'data-testid': 'queue' }, 'Queued message'),
  }))
  try {
    await act(() => render(false))
    expect(element.textContent).toContain('Fixed the issue')
    expect(element.textContent).toContain('引导已接收')
    expect(element.textContent).toContain('file.ts')
    expect(element.textContent).not.toContain('Checking files')
    expect(element.querySelector('[data-slot="file-change-cards"]')).not.toBeNull()
    expect(element.querySelector('.aui-composer-root [data-testid="queue"]')).not.toBeNull()
    const trigger = element.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(() => trigger.click())
    expect(element.textContent).toContain('Checking files')
    await act(() => render(true))
    expect(element.querySelector('[data-slot="collapsible-trigger"]')).toBeNull()
    expect(element.textContent).toContain('Checking files')
  } finally {
    await act(() => root.unmount())
    element.remove()
  }
})


test('loading keeps the dock stable and positions history before revealing the messages', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const messages: RemoteMessage[] = [{ id: 'reply', role: 'assistant', timestamp: 9000, status: 'complete', content: [{ type: 'text', text: 'Final answer' }] }]
  const render = (loading: boolean) => root.render(createElement(RemoteThread, {
    messages: loading ? [] : messages, loading, running: false, busy: false, disabled: loading,
    controls: null, onSend: async () => {}, botName: 'Coder',
  }))
  try {
    await act(() => render(true))
    expect(element.querySelector('[aria-label="Loading conversation"]')).not.toBeNull()
    expect(element.textContent).not.toContain('今天想做些什么')
    const viewport = element.querySelector<HTMLElement>('[aria-busy="true"]')!
    const dock = element.querySelector('.composer-dock')
    const stats = element.querySelector('[data-slot="remote-session-stats"]')
    expect(viewport.classList.contains('invisible')).toBe(true)
    Object.defineProperty(viewport, 'scrollHeight', { value: 1800 })
    await act(() => render(false))
    expect(element.querySelector('[aria-label="Loading conversation"]')).toBeNull()
    expect(element.querySelector('.composer-dock')).toBe(dock)
    expect(element.querySelector('[data-slot="remote-session-stats"]')).toBe(stats)
    expect(viewport.classList.contains('invisible')).toBe(false)
    expect(viewport.scrollTop).toBe(1800)
    expect(element.textContent).toContain('Final answer')
  } finally {
    await act(() => root.unmount())
    element.remove()
  }
})


test('returning to remote history restores the saved location instead of following later replies', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true })
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000)
  const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
  scrollPositions.clear()
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const render = (id: string) => root.render(createElement(RemoteThread, {
    key: id, conversationId: id, messages: [{ id: 'reply', role: 'assistant', timestamp: 1, status: 'complete', content: [{ type: 'text', text: 'Reply' }] }],
    running: false, busy: false, disabled: false, controls: null, onSend: async () => {},
  }))
  try {
    await act(() => render('a'))
    let viewport = element.querySelector<HTMLElement>('[aria-busy="false"]')!
    await act(() => { viewport.scrollTop = 320; viewport.dispatchEvent(new Event('scroll')) })
    await act(() => render('b'))
    await act(() => render('a'))
    viewport = element.querySelector<HTMLElement>('[aria-busy="false"]')!
    expect(viewport.scrollTop).toBe(320)
    expect(scrollPositions.get('a')).toEqual({ top: 320, following: false })
  } finally {
    await act(() => root.unmount())
    element.remove()
    height.mockRestore()
    client.mockRestore()
    scrollPositions.clear()
  }
})
