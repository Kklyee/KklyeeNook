import { ipcMain } from 'electron'
import { AgentService } from '../agentService'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import {
  CreateAgentSessionRequest,
  DeleteAgentSessionRequest,
  RenameAgentSessionRequest,
} from '@/shared/agent/agentSession'

export function registerAgentSessionIpc(agentService: AgentService) {
  ipcMain.handle(
    IPC_CHANNELS.AGENT_SESSION_CREATE,
    async (_event, request: CreateAgentSessionRequest) => {
      const session = agentService.createSession(request.title)
      return session
    },
  )

  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_LIST, async () => {
    return agentService.listSessions()
  })

  ipcMain.handle(
    IPC_CHANNELS.AGENT_SESSION_RENAME,

    (_event, request: RenameAgentSessionRequest) => {
      return agentService.renameSession(request.sessionId, request.title)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.AGENT_SESSION_DELETE,
    (_event, request: DeleteAgentSessionRequest) => {
      return agentService.deleteSession(request.sessionId)
    },
  )
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_CREATE)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_RENAME)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_DELETE)
  }
}
