import { ipcMain, type BrowserWindow } from 'electron'

import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type {
  RemoveContextAttachmentRequest,
  ContextAttachmentRef,
  StageContextAttachmentRequest,
} from '@/shared/context/contextAttachment'

import type { ContextAttachmentService, ResolvedContextAttachment } from './contextAttachmentService'

export interface ContextAttachmentBridge {
  stage(attachment: ResolvedContextAttachment): Promise<void>
  remove(id: string): Promise<void>
}

export function registerContextIpc(
  window: BrowserWindow,
  service: ContextAttachmentService,
  bridge: ContextAttachmentBridge,
): () => void {
  const stage = async (
    event: Electron.IpcMainInvokeEvent,
    request: StageContextAttachmentRequest,
  ): Promise<ContextAttachmentRef> => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted context IPC sender')
    }

    const reference = service.stage(request)
    try {
      await bridge.stage(service.resolve([reference.id])[0]!)
      service.remove(reference.id)
      return reference
    } catch (error) {
      service.remove(reference.id)
      throw error
    }
  }

  const remove = async (
    event: Electron.IpcMainInvokeEvent,
    request: RemoveContextAttachmentRequest,
  ): Promise<void> => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted context IPC sender')
    }

    service.remove(request.id)
    await bridge.remove(request.id).catch(() => undefined)
  }

  ipcMain.handle(IPC_CHANNELS.CONTEXT_ATTACHMENT_STAGE, stage)
  ipcMain.handle(IPC_CHANNELS.CONTEXT_ATTACHMENT_REMOVE, remove)

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.CONTEXT_ATTACHMENT_STAGE)
    ipcMain.removeHandler(IPC_CHANNELS.CONTEXT_ATTACHMENT_REMOVE)
  }
}
