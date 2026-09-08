import { ipcMain } from 'electron'
import { AgentService } from '@/main/agent/agentService'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { CreateAgentSessionRequest } from '@/shared/agent/agentSession'

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

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_CREATE)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SESSION_LIST)
  }
}
