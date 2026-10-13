import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ExecutionProcess } from './ExecutionProcess'

const state = vi.hoisted(() => ({ message: {
  status: { type: 'running' },
  metadata: { steps: [{ messageId: 'first' }, { messageId: 'last' }], custom: { execution: { startedAt: 1000, endedAt: 5000, finalPartIndex: undefined as number | undefined } } },
} }))

vi.mock('@assistant-ui/react', () => ({ useAuiState: (selector: (value: typeof state) => unknown) => selector(state) }))
vi.mock('./AgentActivityProvider', () => ({ useActivitySelector: (selector: (groups: unknown[]) => unknown) => selector([]) }))
vi.mock('./AgentActivityGroup', () => ({ AgentActivityGroup: () => null }))
vi.mock('./AgentActivity', () => ({ ActivityDuration: () => '4秒' }))

afterEach(() => {
  state.message.status.type = 'running'
  state.message.metadata.steps = [{ messageId: 'first' }, { messageId: 'last' }]
  state.message.metadata.custom.execution.finalPartIndex = undefined
})

test.each([1, 2])('only completed replies with at least two steps become collapsible: %s', async (steps) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.message.metadata.steps = Array.from({ length: steps }, (_, index) => ({ messageId: String(index) }))
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const render = () => root.render(createElement(ExecutionProcess, null, 'Intermediate progress'))
  try {
    await act(render)
    expect(element.querySelector('button')).toBeNull()
    expect(element.textContent).toContain('4秒')
    expect(element.textContent).toContain('Intermediate progress')
    state.message.status.type = 'complete'
    state.message.metadata.custom.execution.finalPartIndex = 3
    await act(render)
    const trigger = element.querySelector('button')
    if (steps === 1) {
      expect(trigger).toBeNull()
      expect(element.textContent).toContain('Intermediate progress')
    } else {
      expect(trigger!.getAttribute('aria-expanded')).toBe('false')
      expect(trigger!.textContent).toContain('执行过程')
      await act(() => trigger!.click())
      expect(trigger!.getAttribute('aria-expanded')).toBe('true')
      expect(element.textContent).toContain('Intermediate progress')
      await act(render)
      expect(trigger!.getAttribute('aria-expanded')).toBe('true')
    }
  } finally {
    await act(() => root.unmount())
    element.remove()
  }
})
