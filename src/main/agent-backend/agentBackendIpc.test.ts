import { EventEmitter } from 'node:events'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, test, vi } from 'vitest'

import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentBackendInitOptions, MainToAgentBackendMessage } from './protocol'
import { AgentBackendProcess, type UtilityProcessLike } from './process'
import { registerAgentBackendIpc } from './agentBackendIpc'

const { ipcMain } = vi.hoisted(() => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

vi.mock('electron', () => ({ ipcMain }))

const options: AgentBackendInitOptions = {
  config: {
    model: { provider: 'test', modelID: 'model' },
    tools: { enabled: [] },
  },
  apiKeys: {},
  databaseUrl: 'file:///tmp/app.db',
  migrationsPath: '/tmp/drizzle',
  sessionDir: '/tmp/sessions',
  allowedOrigins: [],
  transport: 'http',
}

const info = { baseUrl: 'http://127.0.0.1:12345/x/api/pi', transport: 'http' as const }

class FakeUtilityProcess extends EventEmitter implements UtilityProcessLike {
  readonly messages: MainToAgentBackendMessage[] = []
  initializeCount = 0
  killed = false

  postMessage(message: unknown): void {
    const typedMessage = message as MainToAgentBackendMessage
    this.messages.push(typedMessage)
    if (typedMessage.type !== 'initialize') return
    this.initializeCount += 1
    queueMicrotask(() => this.emit('message', { type: 'ready', info }))
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

let activeBackend: AgentBackendProcess | undefined

afterEach(() => {
  activeBackend?.close()
  activeBackend = undefined
  vi.clearAllMocks()
})

function makeWindow() {
  const webContents = { mainFrame: {}, send: vi.fn() }
  let closeHandler: (() => void) | undefined
  const window = {
    webContents,
    isDestroyed: vi.fn(() => false),
    once: vi.fn((_event: string, listener: () => void) => {
      closeHandler = listener
    }),
  } as unknown as BrowserWindow

  return { window, webContents, close: () => closeHandler?.() }
}

test('renderer window recreation keeps the backend alive until app shutdown', async () => {
  const child = new FakeUtilityProcess()
  activeBackend = new AgentBackendProcess('/agent-backend-entry.mjs', () => child)
  const backend = activeBackend
  const readyStatus = { state: 'ready' as const, info }

  await expect(backend.start(options)).resolves.toEqual(readyStatus)
  expect(child.initializeCount).toBe(1)

  const firstWindow = makeWindow()
  registerAgentBackendIpc(firstWindow.window, backend)
  firstWindow.close()

  expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_BACKEND_GET_STATUS)
  expect(backend.getStatus()).toEqual(readyStatus)
  expect(child.killed).toBe(false)

  const reopenedWindow = makeWindow()
  registerAgentBackendIpc(reopenedWindow.window, backend)
  const getStatus = ipcMain.handle.mock.calls.at(-1)?.[1] as
    | ((event: IpcMainInvokeEvent) => ReturnType<AgentBackendProcess['getStatus']>)
    | undefined
  const event = {
    sender: reopenedWindow.webContents,
    senderFrame: reopenedWindow.webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent

  expect(getStatus?.(event)).toEqual(readyStatus)
  expect(child.initializeCount).toBe(1)

  backend.close()
  expect(child.messages.at(-1)).toEqual({ type: 'shutdown' })
  expect(child.killed).toBe(true)
})

test('forwards an unexpected backend exit to the active renderer', async () => {
  const child = new FakeUtilityProcess()
  activeBackend = new AgentBackendProcess('/agent-backend-entry.mjs', () => child)
  const window = makeWindow()
  registerAgentBackendIpc(window.window, activeBackend)
  await activeBackend.start(options)

  child.emit('exit', 1)

  expect(window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.AGENT_BACKEND_STATUS, {
    state: 'unavailable',
    message: 'Agent backend stopped unexpectedly.',
  })
})
