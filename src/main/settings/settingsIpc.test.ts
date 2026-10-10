import { beforeEach, expect, test, vi } from 'vitest'
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { registerSettingsIpc } from './settingsIpc'
import { AgentConfigStore } from './agentConfigStore'
import { MemoryCredentialStore, type CredentialStore } from './credentialStore'
import type { ApprovalPolicy } from '../approval/approvalPolicy'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { getAgentModelChoices } from './model-catalog'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
vi.mock('./model-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./model-catalog')>()
  return { ...actual, getAgentModelChoices: vi.fn() }
})

beforeEach(() => vi.clearAllMocks())

function settingsHandlers(contextWindow?: number, credentials: CredentialStore = new MemoryCredentialStore()) {
  const model = { id: 'openai:gpt-4o', provider: 'openai', modelID: 'gpt-4o' }
  vi.mocked(getAgentModelChoices).mockReturnValue({
    providers: [{ id: 'openai' }],
    models: [model],
    catalog: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            contextWindow,
            reasoning: false,
            input: ['text'],
            availableThinkingLevels: ['off'],
            maxTokens: 4_000,
          },
        ],
      },
    ],
  } as ReturnType<typeof getAgentModelChoices>)
  const store = new AgentConfigStore({ model, tools: { enabled: [] } })
  const webContents = { mainFrame: {} }
  const window = { webContents, once: vi.fn() } as unknown as BrowserWindow
  const event = {
    sender: webContents,
    senderFrame: webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent
  const hooks = {
    prepare: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    updateModelSelection: vi.fn(),
  }
  registerSettingsIpc(
    window,
    store,
    credentials,
    { listGrants: async () => [], protects: () => false } as unknown as ApprovalPolicy,
    hooks,
  )
  const handler = (channel: string) =>
    vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1]
  return {
    event,
    store,
    credentials,
    hooks,
    get: handler(IPC_CHANNELS.SETTINGS_GET),
    update: handler(IPC_CHANNELS.SETTINGS_UPDATE),
    testWebSearch: handler(IPC_CHANNELS.SETTINGS_TEST_WEB_SEARCH),
  }
}

test('includes the built-in model context window from the existing catalog in the snapshot', async () => {
  const { get, event } = settingsHandlers(128_000)
  expect(await get(event)).toMatchObject({
    provider: 'openai',
    modelID: 'gpt-4o',
    contextWindow: 128_000,
  })
})

test.each(['reserveTokens', 'keepRecentTokens'] as const)(
  'rejects %s at the known context window before saving',
  async (key) => {
    const { update, event, store, hooks } = settingsHandlers(128_000)
    const original = store.get()
    await expect(
      update(event, {
        compaction: {
          enabled: true,
          reserveTokens: 16_384,
          keepRecentTokens: 20_000,
          [key]: 128_000,
        },
      }),
    ).rejects.toThrow('必须小于当前模型的上下文窗口')
    expect(store.get()).toEqual(original)
    expect(hooks.prepare).not.toHaveBeenCalled()
  },
)

test('saves valid settings and preserves an unknown model window', async () => {
  const { update, event, store, hooks } = settingsHandlers()
  const compaction = { enabled: false, reserveTokens: 160_000, keepRecentTokens: 200_000 }
  const snapshot = await update(event, { compaction })
  expect(snapshot.contextWindow).toBeUndefined()
  expect(snapshot.compaction).toEqual(compaction)
  expect(store.get().compaction).toEqual(compaction)
  expect(hooks.commit).toHaveBeenCalledOnce()
})

test('reports web search configuration without returning stored keys', async () => {
  const credentials = new MemoryCredentialStore()
  credentials.setApiKey('web-search:tavily', 'tvly-secret-value')
  const { get, event } = settingsHandlers(undefined, credentials)

  const snapshot = await get(event)
  expect(snapshot.webSearch).toEqual({
    provider: 'disabled',
    providers: [
      { id: 'tavily', name: 'Tavily', hasApiKey: true },
      { id: 'exa', name: 'Exa', hasApiKey: false },
    ],
  })
  expect(JSON.stringify(snapshot)).not.toContain('tvly-secret-value')
})

test('switching the web search provider keeps every namespaced credential', async () => {
  const credentials = new MemoryCredentialStore()
  const { update, event, store, hooks } = settingsHandlers(undefined, credentials)

  await update(event, {
    webSearch: { provider: 'tavily' },
    webSearchCredential: { provider: 'tavily', apiKey: 'tvly-secret-value' },
  })
  await update(event, {
    webSearch: { provider: 'exa' },
    webSearchCredential: { provider: 'exa', apiKey: 'exa-secret-value' },
  })

  expect(store.get().webSearch).toEqual({ provider: 'exa' })
  expect(credentials.getApiKey('web-search:tavily')).toBe('tvly-secret-value')
  expect(credentials.getApiKey('web-search:exa')).toBe('exa-secret-value')

  const snapshot = await update(event, {
    webSearchCredential: { provider: 'tavily', deleteApiKey: true },
  })
  expect(credentials.hasApiKey('web-search:tavily')).toBe(false)
  expect(credentials.getApiKey('web-search:exa')).toBe('exa-secret-value')
  expect(snapshot.webSearch.providers).toEqual([
    { id: 'tavily', name: 'Tavily', hasApiKey: false },
    { id: 'exa', name: 'Exa', hasApiKey: true },
  ])
  expect(hooks.commit).toHaveBeenCalledTimes(3)
})

test('rejects unknown web search providers and empty keys', async () => {
  const { update, event } = settingsHandlers()

  await expect(update(event, { webSearch: { provider: 'serpapi' } })).rejects.toThrow(
    'Web Search 提供商无效',
  )
  await expect(
    update(event, { webSearchCredential: { provider: 'tavily', apiKey: '   ' } }),
  ).rejects.toThrow('API Key 不能为空')
})

test('answers connection tests with a normalized code', async () => {
  const { testWebSearch, event } = settingsHandlers()

  expect(await testWebSearch(event, { provider: 'tavily' })).toEqual({
    ok: false,
    code: 'web_search_not_configured',
  })
  await expect(testWebSearch(event, { provider: 'serpapi' })).rejects.toThrow(
    'Web Search 提供商无效',
  )
})
