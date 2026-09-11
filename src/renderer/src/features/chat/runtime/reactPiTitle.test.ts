// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AssistantRuntimeProvider, type AssistantRuntime } from '@assistant-ui/react'
import { usePiRuntime, type PiClient, type PiThreadSnapshot } from '@assistant-ui/react-pi'
import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const snapshot: PiThreadSnapshot = {
  metadata: { id: 'thread-1', status: 'idle' },
  messages: [],
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
})

describe('react-pi thread title generation', () => {
  it('persists and publishes a title after the first user message', async () => {
    const renameThread = vi.fn().mockResolvedValue(undefined)
    const client = {
      listThreads: vi.fn().mockResolvedValue([]),
      createThread: vi.fn().mockResolvedValue(snapshot),
      getThread: vi.fn().mockResolvedValue(snapshot),
      subscribe: vi.fn().mockReturnValue(() => undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      renameThread,
    } as unknown as PiClient
    let runtime!: AssistantRuntime

    function Harness() {
      runtime = usePiRuntime({ client })
      return createElement(AssistantRuntimeProvider, { runtime })
    }

    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Harness)))
    await act(async () => undefined)

    await act(async () => runtime.thread.append('First prompt'))

    await vi.waitFor(() => {
      expect(renameThread).toHaveBeenCalledWith('thread-1', 'First prompt')
      const activeId = runtime.threads.getState().mainThreadId
      expect(runtime.threads.getItemById(activeId).getState().title).toBe('First prompt')
    })
  })
})
