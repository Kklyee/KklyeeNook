import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ExecutionProcess } from './ExecutionProcess'

const state = vi.hoisted(() => ({ message: {
  status: { type: 'running' },
  metadata: { custom: { execution: { startedAt: 1000, endedAt: 5000 } } },
} }))

vi.mock('@assistant-ui/react', () => ({ useAuiState: (selector: (value: typeof state) => unknown) => selector(state) }))
vi.mock('./AgentActivityProvider', () => ({ useActivitySelector: (selector: (groups: unknown[]) => unknown) => selector([]) }))
vi.mock('./AgentActivityGroup', () => ({ AgentActivityGroup: () => null }))
vi.mock('./AgentActivity', () => ({ ActivityDuration: () => '4秒' }))

afterEach(() => { state.message.status.type = 'running' })

test.each([false, true])('execution auto-collapses on completion unless explicitly expanded: %s', async (manual) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const render = () => root.render(createElement(ExecutionProcess, null, 'Intermediate progress'))
  try {
    await act(render)
    const trigger = element.querySelector('button')!
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.textContent).toContain('正在执行')
    if (manual) {
      await act(() => trigger.click())
      await act(() => trigger.click())
    }
    state.message.status.type = 'complete'
    await act(render)
    expect(trigger.getAttribute('aria-expanded')).toBe(String(manual))
    expect(trigger.textContent).toContain('执行过程')
    expect(trigger.textContent).toContain('4秒')
    if (!manual) {
      await act(() => trigger.click())
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(element.textContent).toContain('Intermediate progress')
    }
  } finally {
    await act(() => root.unmount())
    element.remove()
  }
})
