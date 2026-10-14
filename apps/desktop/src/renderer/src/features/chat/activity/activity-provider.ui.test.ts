import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { AgentActivityProvider, useActivityReady, useActivitySelector } from './AgentActivityProvider'

const mocks = vi.hoisted(() => ({
  snapshot: { selectedThreadId: 'first', current: { loading: false, messages: [{ id: 'reply' }], projected: { isRunning: false } }, extras: { history: { sinceEntry: 1 } } },
  listeners: new Set<() => void>(), runs: vi.fn(), records: vi.fn(),
}))
vi.mock('../runtime/chat-runtime', () => ({ useChatStore: () => ({ getSnapshot: () => mocks.snapshot, subscribe: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) } }) }))
vi.mock('../../preview/PreviewProvider', () => ({ usePreview: () => ({ refreshFile: vi.fn() }) }))

function Content() {
  const ready = useActivityReady()
  const count = useActivitySelector((groups) => groups.length)
  return createElement('div', { 'data-ready': ready }, ready ? `Reply and ${count} activity groups` : 'Skeleton')
}

test('initial history appears only with activity groups, and returning restores both synchronously', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.snapshot.selectedThreadId = 'history-with-activity'
  mocks.runs.mockResolvedValue([{ id: 'run', status: 'completed', createdAt: 1, startedAt: 1, completedAt: 3, updatedAt: 3 }])
  let finish!: (events: unknown[]) => void
  mocks.records.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  vi.stubGlobal('api', { listAgentRuns: mocks.runs, listAgentExecutionRecords: mocks.records })
  const element = document.createElement('div')
  document.body.append(element)
  let root = createRoot(element)
  const render = () => root.render(createElement(AgentActivityProvider, { sessionId: mocks.snapshot.selectedThreadId, children: createElement(Content) }))
  try {
    await act(async () => render())
    expect(element.textContent).toBe('Skeleton')
    expect(mocks.records).toHaveBeenCalledOnce()
    await act(async () => finish([]))
    expect(element.textContent).toBe('Reply and 1 activity groups')
    await act(() => root.unmount())
    root = createRoot(element)
    mocks.runs.mockImplementation(() => new Promise(() => {}))
    await act(render)
    expect(element.textContent).toBe('Reply and 1 activity groups')
  } finally {
    await act(() => root.unmount())
    element.remove()
    vi.unstubAllGlobals()
    mocks.listeners.clear()
  }
})


test('a newly created empty conversation does not flash a history skeleton while activity loads', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.snapshot.selectedThreadId = 'new-empty-thread'
  mocks.snapshot.current.messages = []
  mocks.runs.mockImplementation(() => new Promise(() => {}))
  vi.stubGlobal('api', { listAgentRuns: mocks.runs, listAgentExecutionRecords: mocks.records })
  const element = document.createElement('div')
  const root = createRoot(element)
  try {
    await act(() => root.render(createElement(AgentActivityProvider, { sessionId: mocks.snapshot.selectedThreadId, children: createElement(Content) })))
    expect(element.textContent).toBe('Reply and 0 activity groups')
  } finally {
    await act(() => root.unmount())
    vi.unstubAllGlobals()
    mocks.listeners.clear()
  }
})
