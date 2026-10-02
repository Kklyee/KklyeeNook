import { ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { PreviewWorkspaceFileRequest } from '@/shared/preview/workspacePreview'
import type { WorkspacePreviewService } from './workspacePreviewService'

export function registerPreviewIpc(
  window: BrowserWindow,
  service: WorkspacePreviewService,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.PREVIEW_WORKSPACE_FILE,
    (event, request: PreviewWorkspaceFileRequest) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        throw new Error('Untrusted preview IPC sender')
      }
      return service.readWorkspaceFile(request)
    },
  )
  return () => ipcMain.removeHandler(IPC_CHANNELS.PREVIEW_WORKSPACE_FILE)
}
