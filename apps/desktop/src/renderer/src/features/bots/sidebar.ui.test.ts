import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, test, vi } from 'vitest'
import { defaultBot } from '@kklyeenook/shared/bot/bot'
import { BotSidebar } from './bot-sidebar'
import { ConversationSettings } from '../settings/ConversationSettings'
import { SessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'

const fixture = vi.hoisted(() => ({
  snapshot: {
    bots: [] as any[],
    threads: [] as any[],
    selectedBotId: 'coder',
    selectedThreadId: 'coder-main',
    current: { metadata: { workspaceId: 'project' } },
  },
  collapsed: false,
  store: {
    selectBot: vi.fn(async (id: string) => {
      fixture.snapshot.selectedBotId = id
    }),
    editBot: vi.fn(),
    reloadThreads: vi.fn(async () => {}),
    archive: vi.fn(async (id: string, archived: boolean) => {
      fixture.snapshot.threads.find((thread) => thread.id === id).archived = archived
    }),
  },
}))
vi.mock('../chat/runtime/chat-runtime', () => ({
  useChatStore: () => fixture.store,
  useChatRuntimeSnapshot: () => fixture.snapshot,
}))
vi.mock('../workspaces/WorkspaceProvider', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'project', displayName: 'Project', status: 'attached' }],
    reload: async () => {},
  }),
}))
vi.mock('../../components/ui/sidebar', () => ({
  useSidebar: () => ({ state: fixture.collapsed ? 'collapsed' : 'expanded', isMobile: false }),
}))
vi.mock('../../components/assistant-ui/elements/thread-list.aui', () => ({
  ThreadListRoot: ({ children }: any) => createElement('div', null, children),
  ThreadListItem: () => null,
}))
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: any) =>
    selector({
      threads: {
        threadIds: fixture.snapshot.threads.map((thread) => thread.id),
        threadItems: fixture.snapshot.threads.map((thread) => ({
          id: thread.id,
          remoteId: thread.id,
        })),
      },
    }),
  ThreadListPrimitive: {
    ItemByIndex: ({ index }: any) =>
      createElement('button', null, fixture.snapshot.threads[index].title),
  },
}))

async function mount(component: React.ReactNode) {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const update = async (next: React.ReactNode) => {
    await act(async () => {
      root.render(next)
    })
  }
  await update(component)
  const click = async (button: Element | null) => {
    expect(button).not.toBeNull()
    await act(async () => {
      ;(button as HTMLElement).click()
    })
  }
  return {
    element,
    update,
    click,
    close: async () => {
      await act(async () => root.unmount())
      element.remove()
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.snapshot.selectedBotId = 'coder'
  fixture.collapsed = false
  fixture.snapshot.bots = ['coder', 'helper'].map((id) => ({
    ...defaultBot(id, id === 'coder' ? 'Coder' : 'Helper', id === 'coder'),
    mainThreadId: id + '-main',
    workspaceIds: ['project'],
    state: 'idle',
  }))
  fixture.snapshot.threads = [
    { id: 'coder-work', botId: 'coder', title: 'Coder work', workspaceId: 'project' },
    { id: 'helper-work', botId: 'helper', title: 'Helper work' },
    { id: 'coder-archive', botId: 'coder', title: 'Archived work', archived: true },
  ]
})

test('My Bots remains exclusive after return, delayed selection and collapsed updates', async () => {
  const view = await mount(createElement(BotSidebar))
  try {
    expect(view.element.textContent).not.toContain('Coder work')
    expect(view.element.querySelector('[aria-label="Coder 设置"]')).toBeNull()
    await view.click(view.element.querySelector('[aria-label="Coder"]'))
    expect(view.element.textContent).toContain('Coder work')
    expect(view.element.textContent).not.toContain('Helper work')
    expect(view.element.textContent).not.toContain('Archived work')
    const folder = view.element.querySelector('[aria-label="展开或折叠 Project"]')!
    expect(folder.hasAttribute('data-panel-open')).toBe(true)
    expect(folder.querySelector('.lucide-chevron-down')).toBeNull()
    await view.click(folder)
    expect(folder.hasAttribute('data-panel-open')).toBe(false)
    await view.click(folder)
    expect(folder.hasAttribute('data-panel-open')).toBe(true)
    await view.click(view.element.querySelector('[aria-label="返回 My Bots"]'))
    fixture.snapshot.selectedBotId = 'helper'
    await view.update(createElement(BotSidebar))
    expect(view.element.querySelector('[data-view="my-bots"]')).not.toBeNull()
    expect(view.element.querySelector('[data-view="bot-threads"]')).toBeNull()
    expect(view.element.textContent).not.toContain('WORKSPACES')
    expect(view.element.textContent).not.toContain('聊天')
    await view.click(view.element.querySelector('[aria-label="Helper"]'))
    expect(view.element.textContent).toContain('Helper work')
    expect(view.element.textContent).not.toContain('Coder work')
    await view.click(view.element.querySelector('[aria-label="返回 My Bots"]'))
    fixture.collapsed = true
    await view.update(createElement(BotSidebar))
    expect(view.element.querySelector('[aria-label="创建 Bot"]')).not.toBeNull()
    expect(view.element.querySelector('[data-view="bot-threads"]')).toBeNull()
  } finally {
    fixture.collapsed = false
    await view.close()
  }
})

test('Settings restores an archived conversation without selecting another Bot', async () => {
  const selected = fixture.snapshot.selectedBotId
  const view = await mount(createElement(ConversationSettings))
  try {
    expect(view.element.textContent).toContain('Archived work')
    expect(view.element.textContent).not.toContain('Helper work')
    await view.click(
      [...view.element.querySelectorAll('button')].find((button) => button.textContent === '恢复')!,
    )
    expect(fixture.store.archive).toHaveBeenCalledWith('coder-archive', false)
    expect(view.element.textContent).not.toContain('Archived work')
    expect(fixture.snapshot.selectedBotId).toBe(selected)
  } finally {
    await view.close()
  }
})

test('Composer status stays compact and detailed statistics open in a Popover', async () => {
  const messages = [
    { role: 'user', content: 'review' },
    {
      role: 'assistant',
      content: [{ type: 'toolCall' }],
      usage: { input: 100, output: 20, cacheRead: 300, cacheWrite: 0 },
    },
  ]
  const view = await mount(
    createElement(
      SessionStats,
      { messages, status: '正在执行…' },
      createElement('span', null, '上下文 12%'),
    ),
  )
  try {
    expect(view.element.textContent).toContain('正在执行…')
    expect(view.element.textContent).toContain('上下文 12%')
    expect(view.element.textContent).not.toContain('Token')
    expect(view.element.textContent).not.toContain('工具调用')
    await view.click(view.element.querySelector('[aria-label="查看会话统计"]'))
    expect(document.body.textContent).toContain('累计 Token')
    expect(document.body.textContent).toContain('420')
    expect(document.body.textContent).toContain('75.0%')
  } finally {
    await view.close()
  }
})
