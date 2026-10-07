import { expect, test, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { registerRemoteIpc } from './remoteIpc'

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => Promise<unknown>>())
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) } }))

test('accepts only the main desktop frame and persists only validated Remote settings', async () => {
  const webContents = { mainFrame: {} }
  const event = { sender: webContents, senderFrame: webContents.mainFrame }
  const config = new AgentConfigStore({ model: { provider: 'test', modelID: 'model' }, tools: { enabled: [] } })
  const request = vi.fn(async () => ({ enabled: true, running: true, tailscale: 'connected' }))
  const dispose = registerRemoteIpc({ webContents } as unknown as BrowserWindow, config, { request })
  const configure = handlers.get(IPC_CHANNELS.REMOTE_CONFIGURE)!
  const status = handlers.get(IPC_CHANNELS.REMOTE_STATUS)!
  try {
    await expect(configure({ ...event, senderFrame: {} }, { enabled: true })).rejects.toThrow('Untrusted sender')
    await expect(status({ ...event, sender: {} })).rejects.toThrow('Untrusted sender')
    await expect(configure(event, { enabled: 'yes' })).rejects.toThrow('Invalid Remote settings')
    expect(request).not.toHaveBeenCalled()
    await configure(event, { enabled: true, allowedLogin: ' kk@example.com ' })
    expect(request).toHaveBeenCalledWith({ action: 'remote:configure', settings: { enabled: true, allowedLogin: 'kk@example.com' } })
    expect(config.get().remote).toEqual({ enabled: true, allowedLogin: 'kk@example.com' })
    await status(event)
    expect(request).toHaveBeenLastCalledWith({ action: 'remote:status' })
  } finally { dispose() }
  expect(handlers.size).toBe(0)
})

test('keeps persisted settings when the backend fails and permits a retry', async () => {
  const webContents = { mainFrame: {} }
  const event = { sender: webContents, senderFrame: webContents.mainFrame }
  const config = new AgentConfigStore({ model: { provider: 'test', modelID: 'model' }, tools: { enabled: [] }, remote: { enabled: false } })
  const request = vi.fn().mockRejectedValueOnce(new Error('Backend unavailable')).mockResolvedValue({ enabled: true, running: true, tailscale: 'connected' })
  const dispose = registerRemoteIpc({ webContents } as unknown as BrowserWindow, config, { request })
  try {
    const configure = handlers.get(IPC_CHANNELS.REMOTE_CONFIGURE)!
    await expect(configure(event, { enabled: true })).rejects.toThrow('Backend unavailable')
    expect(config.get().remote).toEqual({ enabled: false })
    await configure(event, { enabled: true })
    expect(config.get().remote).toEqual({ enabled: true })
  } finally { dispose() }
})
