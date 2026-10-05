import { PERMISSION_MODES, type PermissionMode } from '@/shared/approval/permission'
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentBackendProcess } from '../agent-backend/process'

export function registerWorkspaceIpc(window: BrowserWindow, backend: AgentBackendProcess): () => void {
  const trusted = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted workspace IPC sender')
  }
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, (event) => {
    trusted(event)
    return backend.request({ action: 'workspace:list' })
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_PICK, async (event) => {
    trusted(event)
    const choice = await dialog.showOpenDialog(window, { title: '添加项目', properties: ['openDirectory'] })
    if (choice.canceled || !choice.filePaths[0]) return null
    return backend.request({ action: 'workspace:attach', path: choice.filePaths[0] })
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_ATTACH, (event, input: { path: string; relinkId?: string; createNew?: boolean }) => {
    trusted(event)
    return backend.request({ action: 'workspace:attach', ...input })
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_DETACH, (event, id: string) => {
    trusted(event)
    return backend.request({ action: 'workspace:detach', id })
  })
  ipcMain.handle(IPC_CHANNELS.CONVERSATION_LIST, (event) => {
    trusted(event)
    return backend.request({ action: 'conversation:list' })
  })
  ipcMain.handle(IPC_CHANNELS.CONVERSATION_COMPACT, (event, input: { id: string; instructions?: string }) => {
    trusted(event)
    return backend.request({ action: 'conversation:compact', ...input })
  })
  ipcMain.handle(IPC_CHANNELS.CONVERSATION_CREATE, (event, input: { title?: string; workspaceId: string | null }) => {
    trusted(event)
    return backend.request({ action: 'conversation:create', ...input })
  })
  ipcMain.handle(IPC_CHANNELS.CONVERSATION_PERMISSION, (event, input: { id: string; mode: PermissionMode }) => {
    trusted(event)
    if (!PERMISSION_MODES.includes(input.mode)) throw new Error('权限模式无效')
    return backend.request({ action: 'conversation:permission', ...input })
  })
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.CONVERSATION_COMPACT)
    for (const channel of [IPC_CHANNELS.CONVERSATION_PERMISSION, IPC_CHANNELS.CONVERSATION_LIST, IPC_CHANNELS.CONVERSATION_CREATE, IPC_CHANNELS.WORKSPACE_LIST, IPC_CHANNELS.WORKSPACE_PICK, IPC_CHANNELS.WORKSPACE_ATTACH, IPC_CHANNELS.WORKSPACE_DETACH]) ipcMain.removeHandler(channel)
  }
}
