import { afterEach, expect, test, vi } from 'vitest'

import type { PiClient } from '@assistant-ui/react-pi/node'
import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import { createPiNodeClientAdapter } from './piNodeClientAdapter'

const { createPiNodeClient } = vi.hoisted(() => ({
  createPiNodeClient: vi.fn(),
}))

vi.mock('@assistant-ui/react-pi/node', () => ({ createPiNodeClient }))

const nodeModels = [{
  provider: 'deepseek',
  modelId: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  supportsThinking: true,
}]

function makeNodeClient(models = nodeModels): PiClient {
  return { getAvailableModels: vi.fn(async () => models) } as unknown as PiClient
}

const sharedNodeClient = makeNodeClient()

function makeAppClient(models: Awaited<ReturnType<PiClient['getAvailableModels']>> = []): ContextAwarePiClient {
  return {
    listThreads: vi.fn(async () => []),
    createThread: vi.fn(async () => ({}) as never),
    getThread: vi.fn(async () => ({}) as never),
    sendMessage: vi.fn(async () => undefined),
    cancelRun: vi.fn(async () => undefined),
    clearQueue: vi.fn(async () => ({ steering: [], followUp: [] })),
    getAvailableModels: vi.fn(async () => models),
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    respondToHostUiRequest: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

test('creates one long-lived NodeClient and preserves app-specific Pi methods', async () => {
  vi.mocked(createPiNodeClient).mockReturnValue(sharedNodeClient)
  const firstAppClient = makeAppClient()
  const secondAppClient = makeAppClient()

  const first = createPiNodeClientAdapter(firstAppClient, { workspacePath: 'C:/workspace' })
  const second = createPiNodeClientAdapter(secondAppClient, { workspacePath: 'C:/workspace' })

  await first.listThreads({ includeArchived: true })
  await second.sendMessage('thread-1', { content: 'with app context' }, ['attachment-1'])

  expect(createPiNodeClient).toHaveBeenCalledOnce()
  expect(createPiNodeClient).toHaveBeenCalledWith({ workspacePath: 'C:/workspace' })
  expect(firstAppClient.listThreads).toHaveBeenCalledWith({ includeArchived: true })
  expect(secondAppClient.sendMessage).toHaveBeenCalledWith(
    'thread-1',
    { content: 'with app context' },
    ['attachment-1'],
  )
})

test('uses the NodeClient model catalog only when the app catalog is empty', async () => {
  vi.mocked(createPiNodeClient).mockReturnValue(sharedNodeClient)
  const appClient = makeAppClient()
  const adapter = createPiNodeClientAdapter(appClient, { workspacePath: 'C:/workspace' })

  await expect(adapter.getAvailableModels()).resolves.toEqual(nodeModels)
  expect(sharedNodeClient.getAvailableModels).toHaveBeenCalledOnce()
})
