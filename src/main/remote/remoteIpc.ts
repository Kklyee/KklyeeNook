import { ipcMain, type BrowserWindow } from 'electron'
import type { AgentConfigStore } from '../settings/agentConfigStore'
import type { AgentBackendRequest } from '../agent-backend/protocol'
import type { RemoteSettings, RemoteStatus } from '@kklyeenook/shared/remote/index'
import { IPC_CHANNELS } from '@/shared/ipc/channels'

export function registerRemoteIpc(window: BrowserWindow, config: AgentConfigStore, backend: { request(request: AgentBackendRequest): Promise<unknown> }) {
  let updating = false
  for (const channel of [IPC_CHANNELS.REMOTE_STATUS, IPC_CHANNELS.REMOTE_CONFIGURE]) {
    ipcMain.handle(channel, async (event, settings?: RemoteSettings): Promise<RemoteStatus> => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted sender')
      if (channel === IPC_CHANNELS.REMOTE_STATUS) return backend.request({ action: 'remote:status' }) as Promise<RemoteStatus>
      if (!settings || typeof settings.enabled !== 'boolean' || (settings.allowedLogin !== undefined && typeof settings.allowedLogin !== 'string')) throw new Error('Invalid Remote settings')
      if (updating) throw new Error('Remote settings are being updated')
      updating = true
      try {
        const next = { enabled: settings.enabled, allowedLogin: settings.allowedLogin?.trim() || undefined }
        const status = await backend.request({ action: 'remote:configure', settings: next }) as RemoteStatus
        config.set({ ...config.get(), remote: next })
        return status
      } finally { updating = false }
    })
  }
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.REMOTE_STATUS)
    ipcMain.removeHandler(IPC_CHANNELS.REMOTE_CONFIGURE)
  }
}
