// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@assistant-ui/react', async () => {
  const { forwardRef, createElement } = await import('react')
  return {
    ThreadPrimitive: { Viewport: forwardRef<HTMLDivElement, { children: ReactNode }>((props, ref) => createElement('div', { ref }, props.children)) },
    useAui: () => ({ thread: { getState: () => ({}) } }),
    useAuiEvent: () => {},
    useAuiState: (selector: (state: unknown) => unknown) => selector({ threads: { mainThreadId: 'thread' }, thread: { isLoading: false, messages: [{}] } }),
  }
})

import { ThreadScrollViewport, useScrollFollower } from './thread-scroll-follower'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

test('jump to latest reaches the DOM bottom and stays following during measurement corrections', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  let resize!: ResizeObserverCallback
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback } observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  function Controls() {
    const follower = useScrollFollower()
    return createElement('button', { onClick: follower.resume, 'data-following': follower.following }, 'Latest')
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let viewport!: HTMLDivElement
  act(() => { root!.render(createElement(ThreadScrollViewport, { children: createElement(Controls) })) })
  viewport = container.firstElementChild as HTMLDivElement
  Object.defineProperties(viewport, { scrollHeight: { get: () => 1000 }, clientHeight: { get: () => 100 } })
  const button = container.querySelector('button')!
  act(() => { viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })) })
  expect(button.dataset.following).toBe('false')
  act(() => { button.click() })
  act(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } })
  expect(viewport.scrollTop).toBe(900)
  act(() => { viewport.dispatchEvent(new Event('scroll')); viewport.scrollTop = 800; viewport.dispatchEvent(new Event('scroll')) })
  expect(button.dataset.following).toBe('true')
  act(() => { resize([], {} as ResizeObserver); for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } })
  expect(viewport.scrollTop).toBe(900)
  expect(button.dataset.following).toBe('true')
})
