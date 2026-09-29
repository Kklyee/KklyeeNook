import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import type { AgentBackendProcess } from '@/main/agent-backend/process'
import type { McpServerState } from '@/shared/mcp/mcpServer'
import { IPC_CHANNELS } from '@/shared/ipc/channels'

export function registerMcpIpc(window: BrowserWindow, backend: AgentBackendProcess): () => void {
  const assertTrustedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('不允许管理 MCP Server')
    }
  }

  const list = async (event: IpcMainInvokeEvent): Promise<McpServerState[]> => {
    assertTrustedSender(event)
    return backend.request({ action: 'mcp:list' })
  }
  const connect = async (event: IpcMainInvokeEvent, serverId: string): Promise<McpServerState> => {
    assertTrustedSender(event)
    return backend.request({ action: 'mcp:connect', serverId })
  }
  const disconnect = async (event: IpcMainInvokeEvent, serverId: string): Promise<void> => {
    assertTrustedSender(event)
    return backend.request({ action: 'mcp:disconnect', serverId })
  }
  const retry = async (event: IpcMainInvokeEvent, serverId: string): Promise<McpServerState> => {
    assertTrustedSender(event)
    return backend.request({ action: 'mcp:retry', serverId })
  }
  const dispose = () => {
    ipcMain.removeHandler(IPC_CHANNELS.MCP_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.MCP_CONNECT)
    ipcMain.removeHandler(IPC_CHANNELS.MCP_DISCONNECT)
    ipcMain.removeHandler(IPC_CHANNELS.MCP_RETRY)
  }

  ipcMain.handle(IPC_CHANNELS.MCP_LIST, list)
  ipcMain.handle(IPC_CHANNELS.MCP_CONNECT, connect)
  ipcMain.handle(IPC_CHANNELS.MCP_DISCONNECT, disconnect)
  ipcMain.handle(IPC_CHANNELS.MCP_RETRY, retry)

  window.once('closed', dispose)
  return dispose
}
