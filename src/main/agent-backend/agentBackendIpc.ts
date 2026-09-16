import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentBackendProcess } from './process'

export function registerAgentBackendIpc(
  window: BrowserWindow,
  backend: AgentBackendProcess,
): () => void {
  const assertTrusted = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted agent backend IPC sender')
    }
  }
  const getStatus = (event: IpcMainInvokeEvent) => {
    assertTrusted(event)
    return backend.getStatus()
  }
  const unsubscribe = backend.onStatusChange((status) => {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.AGENT_BACKEND_STATUS, status)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_BACKEND_GET_STATUS, getStatus)
  const dispose = () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_BACKEND_GET_STATUS)
    unsubscribe()
  }
  window.once('closed', dispose)
  return dispose
}
