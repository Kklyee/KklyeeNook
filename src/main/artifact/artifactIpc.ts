import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'

import {
  artifactFilename,
  type ApplyArtifactRequest,
  type ExportArtifactRequest,
  type ListArtifactsRequest,
} from '@/shared/artifact/artifact'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { ArtifactService } from './artifactService'

export function registerArtifactIpc(
  mainWindow: BrowserWindow,
  service: ArtifactService,
): () => void {
  const trusted = (event: IpcMainInvokeEvent) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error('Untrusted artifact IPC sender')
  }
  ipcMain.handle(IPC_CHANNELS.ARTIFACT_LIST, (event, request: ListArtifactsRequest) => {
    trusted(event)
    return service.list(request.sessionId, request.runId)
  })
  ipcMain.handle(IPC_CHANNELS.ARTIFACT_APPLY, async (event, request: ApplyArtifactRequest) => {
    trusted(event)
    return {
      path: await service.apply(request.artifactId, async (reason) => {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: '本次文件权限',
          message: reason,
          buttons: ['允许一次', '拒绝'],
          defaultId: 1,
          cancelId: 1,
        })
        return choice.response === 0
      }),
    }
  })
  ipcMain.handle(IPC_CHANNELS.ARTIFACT_EXPORT, async (event, request: ExportArtifactRequest) => {
    trusted(event)
    const artifact = await service.get(request.artifactId)
    if (!artifact) throw new Error(`Artifact not found: ${request.artifactId}`)
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: 'Export artifact',
      defaultPath: artifactFilename(artifact),
    })
    if (choice.canceled || !choice.filePath) return { canceled: true }
    await writeFile(choice.filePath, service.exportContent(artifact), 'utf8')
    return { path: choice.filePath }
  })

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.ARTIFACT_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.ARTIFACT_APPLY)
    ipcMain.removeHandler(IPC_CHANNELS.ARTIFACT_EXPORT)
  }
}
