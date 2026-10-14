import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { AssistantRuntimeProvider, ComposerPrimitive, useLocalRuntime, type AttachmentAdapter } from '@assistant-ui/react'
import { BotMentionInput } from './BotMentionInput'

const store = vi.hoisted(() => ({ mentionTargets: async () => [] }))
const snapshot = vi.hoisted(() => ({ selectedThreadId: 'thread', bots: [] }))
vi.mock('../runtime/chat-runtime', () => ({
  useChatStore: () => store,
  useChatRuntimeSnapshot: () => snapshot,
}))

const adapter: AttachmentAdapter = {
  accept: 'image/*',
  async add({ file }) {
    return {
      id: 'pasted',
      type: 'image',
      name: file.name,
      contentType: file.type,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    }
  },
  async send(attachment) {
    return { ...attachment, status: { type: 'complete' }, content: [] }
  },
  async remove() {},
}

test('pasting an image file adds it as a composer attachment', async () => {
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
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  let runtime: ReturnType<typeof useLocalRuntime>
  function Fixture() {
    runtime = useLocalRuntime(
      { run: async () => ({ content: [] }) },
      { adapters: { attachments: adapter } },
    )
    return createElement(
      AssistantRuntimeProvider,
      { runtime },
      createElement(
        ComposerPrimitive.Unstable_TriggerPopoverRoot,
        null,
        createElement(
          ComposerPrimitive.Root,
          null,
          createElement(BotMentionInput, {
            placeholder: '消息',
            autoFocus: true,
            submit: async () => {},
          }),
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
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    await flush(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: DataTransfer
      }
      Object.defineProperty(event, 'clipboardData', { value: { files: [file] } })
      input.dispatchEvent(event)
    })
    const attachments = runtime!.thread.composer.getState().attachments
    expect(attachments.map((attachment) => attachment.name)).toContain('shot.png')
  } finally {
    await flush(() => root.unmount())
    element.remove()
  }
})
