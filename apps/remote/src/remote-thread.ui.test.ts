import { act, createElement } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { RemoteThread } from './remote-thread'
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
