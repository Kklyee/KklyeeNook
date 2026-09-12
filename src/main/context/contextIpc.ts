import { ipcMain, type BrowserWindow } from 'electron'

import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type {
  RemoveContextAttachmentRequest,
  StageContextAttachmentRequest,
} from '@/shared/context/contextAttachment'

import type { ContextAttachmentService } from './contextAttachmentService'

export function registerContextIpc(
  window: BrowserWindow,
  service: ContextAttachmentService,
): () => void {
  const stage = (event: Electron.IpcMainInvokeEvent, request: StageContextAttachmentRequest) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted context IPC sender')
    }

    return service.stage(request)
  }

  const remove = (event: Electron.IpcMainInvokeEvent, request: RemoveContextAttachmentRequest) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted context IPC sender')
    }

    service.remove(request.id)
  }

  ipcMain.handle(IPC_CHANNELS.CONTEXT_ATTACHMENT_STAGE, stage)
  ipcMain.handle(IPC_CHANNELS.CONTEXT_ATTACHMENT_REMOVE, remove)

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.CONTEXT_ATTACHMENT_STAGE)
    ipcMain.removeHandler(IPC_CHANNELS.CONTEXT_ATTACHMENT_REMOVE)
  }
}
