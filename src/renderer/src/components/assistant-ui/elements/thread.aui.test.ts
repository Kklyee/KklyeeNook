// @vitest-environment jsdom

import { act, type ReactNode, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  viewportProps: undefined as Record<string, unknown> | undefined,
}))

const state = {
  thread: { messages: [], isLoading: false, isDisabled: false },
  threads: { isLoading: false },
}

vi.mock('@assistant-ui/react', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null

  return {
    ActionBarMorePrimitive: {},
    ActionBarPrimitive: {},
    AuiIf: passthrough,
    BranchPickerPrimitive: {},
    ComposerPrimitive: {},
    ErrorPrimitive: {},
    groupPartByType: () => ({}),
    MessagePrimitive: {},
    SuggestionPrimitive: {},
    ThreadPrimitive: {
      Root: passthrough,
      Viewport: (props: Record<string, unknown>) => {
        mocks.viewportProps = props
        return null
      },
    },
    useAuiState: (selector: (value: typeof state) => unknown) => selector(state),
  }
})

import { Thread } from './thread.aui'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  mocks.viewportProps = undefined
  document.body.innerHTML = ''
})

test('follows generated chat output while preserving assistant-ui scroll behavior', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await act(() => root!.render(createElement(Thread)))

  expect(mocks.viewportProps).toMatchObject({
    autoScroll: true,
    turnAnchor: 'bottom',
    scrollToBottomOnRunStart: true,
    scrollToBottomOnInitialize: true,
    scrollToBottomOnThreadSwitch: true,
  })
})
