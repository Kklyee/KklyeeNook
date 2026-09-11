import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'

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
  ipcMain.handle(IPC_CHANNELS.ARTIFACT_LIST, (_event, request: ListArtifactsRequest) =>
    service.list(request.sessionId, request.runId),
  )
  ipcMain.handle(IPC_CHANNELS.ARTIFACT_APPLY, async (_event, request: ApplyArtifactRequest) => ({
    path: await service.apply(request.artifactId),
  }))
  ipcMain.handle(IPC_CHANNELS.ARTIFACT_EXPORT, async (_event, request: ExportArtifactRequest) => {
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
