import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { MessageQueue, type QueuedMessage } from '@kklyeenook/ui/assistant-ui/message-queue'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}
Object.assign(globalThis, { ResizeObserver: ResizeObserverStub })
HTMLElement.prototype.setPointerCapture = () => {}

const queued: QueuedMessage[] = [
  { id: 's1', text: '引导这条', steer: true, index: 0, expected: ['引导这条'] },
  { id: 'a', text: '第一条', steer: false, index: 0, expected: ['第一条', '第二条', '第三条'] },
  { id: 'b', text: '第二条', steer: false, index: 1, expected: ['第一条', '第二条', '第三条'] },
  { id: 'c', text: '第三条', steer: false, index: 2, expected: ['第一条', '第二条', '第三条'] },
]

const ROW_HEIGHT = 24

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

function mount(overrides: Partial<Parameters<typeof MessageQueue>[0]> = {}) {
  const props = {
    queued,
    clearing: false,
    onClear: vi.fn(),
    onRemove: vi.fn(),
    onSteer: vi.fn(),
    onEdit: vi.fn(async () => true),
    onMove: vi.fn(),
    ...overrides,
  }
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  act(() => root!.render(createElement(MessageQueue, props)))
  return { element, props }
}

function layout(element: HTMLElement) {
  element.querySelectorAll<HTMLElement>('[data-queue-id]').forEach((row, index) => {
    row.getBoundingClientRect = () =>
      ({
        top: index * ROW_HEIGHT,
        bottom: index * ROW_HEIGHT + ROW_HEIGHT,
        height: ROW_HEIGHT,
        y: index * ROW_HEIGHT,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        toJSON: () => ({}),
      }) as DOMRect
  })
}

function order(element: HTMLElement) {
  return Array.from(element.querySelectorAll('[data-queue-id]')).map((row) =>
    row.getAttribute('data-queue-id'),
  )
}

function pointer(target: Element, type: string, clientY: number) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientY,
        button: 0,
        pointerId: 1,
        isPrimary: true,
      }),
    )
  })
}

async function hold() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320))
  })
}

test('long press reorders queued messages and commits one offset move', async () => {
  const { element, props } = mount()
  layout(element)
  const row = element.querySelector('[data-queue-id="a"]')!
  pointer(row, 'pointerdown', ROW_HEIGHT * 1.5)
  await hold()
  layout(element)
  pointer(row, 'pointermove', ROW_HEIGHT * 3.5)
  expect(order(element)).toEqual(['s1', 'b', 'c', 'a'])
  pointer(row, 'pointerup', ROW_HEIGHT * 3.5)
  expect(props.onMove).toHaveBeenCalledExactlyOnceWith(queued[1], 2)
  expect(order(element)).toEqual(['s1', 'a', 'b', 'c'])
})

test('a press without holding, or a scroll, never reorders', async () => {
  const { element, props } = mount()
  layout(element)
  const row = element.querySelector('[data-queue-id="a"]')!
  pointer(row, 'pointerdown', ROW_HEIGHT * 1.5)
  pointer(row, 'pointerup', ROW_HEIGHT * 1.5)
  expect(props.onMove).not.toHaveBeenCalled()
  pointer(row, 'pointerdown', ROW_HEIGHT * 1.5)
  pointer(row, 'pointermove', ROW_HEIGHT * 8)
  await hold()
  layout(element)
  pointer(row, 'pointermove', ROW_HEIGHT * 3.5)
  pointer(row, 'pointerup', ROW_HEIGHT * 3.5)
  expect(props.onMove).not.toHaveBeenCalled()
  expect(order(element)).toEqual(['s1', 'a', 'b', 'c'])
})

test('dragging stays inside its own lane', async () => {
  const { element, props } = mount()
  layout(element)
  const row = element.querySelector('[data-queue-id="a"]')!
  pointer(row, 'pointerdown', ROW_HEIGHT * 1.5)
  await hold()
  layout(element)
  pointer(row, 'pointermove', 0)
  pointer(row, 'pointerup', 0)
  expect(props.onMove).not.toHaveBeenCalled()
  expect(order(element)).toEqual(['s1', 'a', 'b', 'c'])
})

test('the grip starts a drag without waiting for the hold', () => {
  const { element, props } = mount()
  layout(element)
  const grip = element.querySelector('[data-queue-id="a"] [data-slot="queue-grip"]')!
  pointer(grip, 'pointerdown', ROW_HEIGHT * 1.5)
  layout(element)
  pointer(grip, 'pointermove', ROW_HEIGHT * 3.5)
  pointer(grip, 'pointerup', ROW_HEIGHT * 3.5)
  expect(props.onMove).toHaveBeenCalledExactlyOnceWith(queued[1], 2)
})

test('each queued message exposes steer, edit and delete without extra text', () => {
  const { element, props } = mount()
  const labels = (name: string) => Array.from(element.querySelectorAll(`[aria-label="${name}"]`))
  expect(labels('引导当前任务')).toHaveLength(3)
  expect(labels('编辑')).toHaveLength(4)
  expect(labels('删除')).toHaveLength(4)
  expect(labels('引导当前任务')[0]!.textContent).toBe('')
  expect(element.textContent).not.toContain('已排队')
  expect(element.textContent).not.toContain('清空')
  act(() => (labels('引导当前任务')[1] as HTMLElement).click())
  expect(props.onSteer).toHaveBeenCalledExactlyOnceWith(queued[2])
  act(() => (labels('删除')[1] as HTMLElement).click())
  expect(props.onRemove).toHaveBeenCalledExactlyOnceWith(queued[1])
  act(() => (labels('清空待执行消息')[0] as HTMLElement).click())
  expect(props.onClear).toHaveBeenCalledOnce()
})

test('editing a queued message saves on Enter and cancels on Escape', async () => {
  const { element, props } = mount()
  act(() => (element.querySelector('[aria-label="编辑"]') as HTMLElement).click())
  const textarea = element.querySelector('textarea')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(textarea, '改过的内容')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
  })
  expect(props.onEdit).toHaveBeenCalledExactlyOnceWith(queued[0], '改过的内容')
  expect(element.querySelector('textarea')).toBeNull()
  act(() => (element.querySelector('[aria-label="编辑"]') as HTMLElement).click())
  expect(element.querySelector('textarea')).not.toBeNull()
  await act(async () => {
    element
      .querySelector('textarea')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
  })
  expect(element.querySelector('textarea')).toBeNull()
  expect(props.onEdit).toHaveBeenCalledOnce()
})

test('alt arrow keys reorder without a pointer', () => {
  const { element, props } = mount()
  act(() => {
    element
      .querySelector('[data-queue-id="a"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
  })
  expect(props.onMove).toHaveBeenCalledExactlyOnceWith(queued[1], 1)
})
