import { beforeEach, expect, test, vi } from 'vitest'
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { registerSettingsIpc } from './settingsIpc'
import { AgentConfigStore } from './agentConfigStore'
import type { CredentialStore } from './credentialStore'
import type { ApprovalPolicy } from '../approval/approvalPolicy'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { getAgentModelChoices } from './modelCatalog'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
vi.mock('./modelCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./modelCatalog')>()
  return { ...actual, getAgentModelChoices: vi.fn() }
})

beforeEach(() => vi.clearAllMocks())

function settingsHandlers(contextWindow?: number) {
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
    { hasApiKey: () => false, isPersistenceAvailable: () => false } as unknown as CredentialStore,
    { listGrants: async () => [], protects: () => false } as unknown as ApprovalPolicy,
    hooks,
  )
  const handler = (channel: string) =>
    vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1]
  return {
    event,
    store,
    hooks,
    get: handler(IPC_CHANNELS.SETTINGS_GET),
    update: handler(IPC_CHANNELS.SETTINGS_UPDATE),
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
