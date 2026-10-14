// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ id: 'thread', loading: false }))

vi.mock('@assistant-ui/react', async () => {
  const { forwardRef, createElement } = await import('react')
  return {
    ThreadPrimitive: { Viewport: forwardRef<HTMLDivElement, { children: ReactNode }>((props, ref) => createElement('div', { ref }, props.children)) },
    useAui: () => ({ thread: { getState: () => ({}) } }),
    useAuiEvent: () => {},
    useAuiState: (selector: (state: unknown) => unknown) => selector({ threads: { mainThreadId: state.id }, thread: { isLoading: state.loading, messages: [{}] } }),
  }
})

import { scrollPositions } from '@kklyeenook/ui/assistant-ui/scroll-position'
import { ThreadScrollViewport, useScrollFollower } from './thread-scroll-follower'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  scrollPositions.clear()
  state.id = 'thread'
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


test('first open snaps immediately and returning restores paused history without scheduling a scroll', () => {
  const raf = vi.fn(() => 1)
  const observers: ResizeObserverCallback[] = []
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback) } observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = () => root!.render(createElement(ThreadScrollViewport, { key: state.id, children: 'History' }))
  act(render)
  let viewport = container.firstElementChild as HTMLDivElement
  expect(viewport.scrollTop).toBe(900)
  act(() => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
    viewport.scrollTop = 320
    viewport.dispatchEvent(new Event('scroll'))
  })
  state.id = 'other'
  act(render)
  viewport = container.firstElementChild as HTMLDivElement
  expect(viewport.scrollTop).toBe(900)
  state.id = 'thread'
  act(render)
  viewport = container.firstElementChild as HTMLDivElement
  expect(viewport.scrollTop).toBe(320)
  act(() => observers.at(-1)!([], {} as ResizeObserver))
  expect(viewport.scrollTop).toBe(320)
  expect(raf).not.toHaveBeenCalled()
})


test('restores a saved location only after message and activity content are ready', () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
  scrollPositions.set('thread', { top: 320, following: false })
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = (contentReady: boolean) => root!.render(createElement(ThreadScrollViewport, { contentReady, children: contentReady ? 'Complete history and activities' : 'Skeleton' }))
  act(() => render(false))
  const viewport = container.firstElementChild as HTMLDivElement
  expect(viewport.scrollTop).toBe(0)
  act(() => render(true))
  expect(viewport.scrollTop).toBe(320)
  expect(container.textContent).toContain('Complete history and activities')
})
