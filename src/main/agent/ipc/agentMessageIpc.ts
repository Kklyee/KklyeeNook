import { ipcMain } from 'electron'

import type { AgentMessageSnapshot, LoadAgentMessagesRequest } from '@/shared/chat/chatHistory'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentMessageService } from '../agentMessageService'

export function registerAgentMessageIpc(service: AgentMessageService): () => void {
  ipcMain.handle(
    IPC_CHANNELS.AGENT_MESSAGE_LIST,

    async (_event, request: LoadAgentMessagesRequest) => {
      return service.list(request.sessionId)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.AGENT_MESSAGE_SAVE,

    async (_event, message: AgentMessageSnapshot) => {
      await service.save(message)
    },
  )

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_MESSAGE_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_MESSAGE_SAVE)
  }
}
