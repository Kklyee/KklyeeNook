import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { AssistantRuntimeProvider, ComposerPrimitive, useLocalRuntime } from '@assistant-ui/react'
import { $getRoot, $isElementNode, $isTextNode, getNearestEditorFromDOMNode } from 'lexical'
import { BotMentionInput } from './BotMentionInput'
import { botMentionFormatter } from '@kklyeenook/shared/bot/mentions'

const store = vi.hoisted(() => ({
  mentionTargets: async () => [
    {
      botId: 'coder-id',
      name: 'Coder',
      role: '编程助手',
      source: 'local',
      owned: true,
      allowed: true,
      online: true,
    },
    {
      botId: 'designer-id',
      name: 'Designer',
      role: '设计助手',
      source: 'remote',
      owned: false,
      allowed: true,
      online: false,
    },
  ],
}))
vi.mock('../runtime/chat-runtime', () => ({
  useChatStore: () => store,
  useChatRuntimeSnapshot: () => ({ selectedThreadId: 'thread' }),
}))

test('Mention hints appear only while triggered and editor keyboard actions preserve atomic tokens', async () => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  const submit = vi.fn(async () => {})
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  let runtime: ReturnType<typeof useLocalRuntime>
  function Fixture() {
    runtime = useLocalRuntime({ run: async () => ({ content: [] }) })
    return createElement(
      AssistantRuntimeProvider,
      { runtime },
      createElement(
        ComposerPrimitive.Unstable_TriggerPopoverRoot,
        null,
        createElement(
          ComposerPrimitive.Root,
          null,
          createElement(BotMentionInput, { placeholder: '消息', autoFocus: true, submit }),
        ),
      ),
    )
  }
  const flush = async (action: () => void) => {
    await act(async () => {
      action()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
  }
  try {
    await flush(() => root.render(createElement(Fixture)))
    const input = element.querySelector('[contenteditable="true"]')!
    const editor = getNearestEditorFromDOMNode(input)!
    expect(element.textContent).not.toContain('提及 Bot')
    expect(element.textContent).not.toContain('Esc 关闭')
    await flush(() =>
      editor.update(() => {
        $getRoot().selectEnd().insertText('请 @')
      }),
    )
    expect(element.querySelector('[role="listbox"]')).not.toBeNull()
    await flush(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      ),
    )
    await flush(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    )
    expect(input.querySelector('[data-bot-id="designer-id"]')).not.toBeNull()
    expect(runtime!.thread.composer.getState().text).toContain(
      botMentionFormatter.serialize({ id: 'designer-id', label: 'Designer' }),
    )
    expect(submit).not.toHaveBeenCalled()
    expect(element.textContent).not.toContain('Esc 关闭')
    await flush(() => runtime!.thread.composer.setText('下一步 @C'))
    expect(element.querySelector('[role="listbox"]')).not.toBeNull()
    await flush(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    )
    expect(element.querySelector('[role="listbox"]')).toBeNull()
    expect(element.textContent).not.toContain('提及 Bot')
    await flush(() =>
      runtime!.thread.composer.setText(
        '前' + botMentionFormatter.serialize({ id: 'coder-id', label: 'Coder' }) + '后',
      ),
    )
    await flush(() =>
      editor.update(() => {
        const paragraph = $getRoot().getFirstChild()
        const text = $isElementNode(paragraph) ? paragraph.getLastChild() : undefined
        if ($isTextNode(text)) text.select(0, 0)
      }),
    )
    await flush(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      ),
    )
    expect(runtime!.thread.composer.getState().text).toBe('前后')
    expect(input.querySelector('[data-bot-id]')).toBeNull()
    await flush(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    )
    expect(submit).toHaveBeenCalledOnce()
  } finally {
    await flush(() => root.unmount())
    element.remove()
  }
})
