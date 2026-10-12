import { expect, test, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { GroveConnection } from '../grove/connection'
import { registerGroveIpc } from './groveIpc'
import { IPC_CHANNELS } from '@kklyeenook/shared/ipc/channels'

const handlers = new Map<string, (...args: any[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

test('Grove credentials and User management operations only accept the trusted main frame', async () => {
  const webContents = { mainFrame: {} }
  const event = { sender: webContents, senderFrame: webContents.mainFrame }
  const configure = vi.fn(async () => ({ enabled: true }))
  const status = vi.fn(async () => ({ enabled: false }))
  const grant = vi.fn()
  const grove = { configure, status, account: () => ({ grant }) } as unknown as GroveConnection
  const dispose = registerGroveIpc({ webContents } as unknown as BrowserWindow, grove)
  try {
    for (const handler of handlers.values()) {
      await expect(handler({ ...event, sender: {} }, {})).rejects.toThrow('Untrusted')
      await expect(handler({ ...event, senderFrame: {} }, {})).rejects.toThrow('Untrusted')
    }
    expect(configure).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
    await handlers.get(IPC_CHANNELS.GROVE_STATUS)!(event)
    expect(status).toHaveBeenCalledOnce()
    await handlers.get(IPC_CHANNELS.GROVE_CONFIGURE)!(event, { enabled: false, relayUrl: '' })
    expect(configure).toHaveBeenCalledWith({ enabled: false, relayUrl: '' })
  } finally {
    dispose()
  }
  expect(handlers.size).toBe(0)
})
