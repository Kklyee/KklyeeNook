import { ipcMain } from 'electron'
import { AgentService } from '../agentService'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import {
  CreateAgentSessionRequest,
  DeleteAgentSessionRequest,
  RenameAgentSessionRequest,
} from '@/shared/agent/agentSession'
import { LoadAgentRunsRequest } from '@/shared/agent/agentRun'

export function registerAgentSessionIpc(agentService: AgentService) {
  ipcMain.handle(
    IPC_CHANNELS.AGENT_SESSION_CREATE,
    async (_event, request: CreateAgentSessionRequest) => {
      const session = await agentService.createSession(request.title)
      return session
    },
  )

  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_LIST, async () => {
    return await agentService.listSessions()
  })

  ipcMain.handle(
    IPC_CHANNELS.AGENT_SESSION_RENAME,

    async (_event, request: RenameAgentSessionRequest) => {
      return await agentService.renameSession(request.sessionId, request.title)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.AGENT_SESSION_DELETE,
    async (_event, request: DeleteAgentSessionRequest) => {
      return await agentService.deleteSession(request.sessionId)
    },
  )
  ipcMain.handle(IPC_CHANNELS.AGENT_RUN_LIST, async (_event, request: LoadAgentRunsRequest) => {
    return await agentService.listRuns(request.sessionId)
  })
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_CREATE)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_RENAME)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_DELETE)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_RUN_LIST)
  }
}
