import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import type { DeleteAgentMemoryRequest } from '@/shared/memory/agentMemory'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentMemoryRepo } from '../db/repositories/memoryRepo'

export function registerMemoryIpc(
  window: BrowserWindow,
  repo: AgentMemoryRepo,
  workspace: () => string,
): () => void {
  const assertTrustedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted memory IPC sender')
    }
  }

  const list = async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event)
    return repo.list(workspace())
  }

  const remove = async (
    event: IpcMainInvokeEvent,
    request: DeleteAgentMemoryRequest,
  ): Promise<void> => {
    assertTrustedSender(event)
    if (!request || typeof request.id !== 'string' || !request.id.trim()) {
      throw new Error('Memory id is required')
    }
    await repo.delete(request.id)
  }

  ipcMain.handle(IPC_CHANNELS.MEMORY_LIST, list)
  ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, remove)

  const dispose = () => {
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_DELETE)
  }
  window.once('closed', dispose)
  return dispose
}
