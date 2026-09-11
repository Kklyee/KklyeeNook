import { ipcMain } from 'electron'

import type { LoadAgentExecutionRecordsRequest } from '@/shared/agent/agentExecutionRecord'
import type { LoadAgentRunsRequest } from '@/shared/agent/agentRun'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentService } from '../agentService'

export function registerAgentRunIpc(agentService: AgentService): () => void {
  ipcMain.handle(IPC_CHANNELS.AGENT_RUN_LIST, (_event, request: LoadAgentRunsRequest) =>
    agentService.listRuns(request.sessionId),
  )
  ipcMain.handle(
    IPC_CHANNELS.AGENT_EXECUTION_RECORD_LIST,
    (_event, request: LoadAgentExecutionRecordsRequest) =>
      agentService.listExecutionRecords(request.runId),
  )
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_RUN_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_EXECUTION_RECORD_LIST)
  }
}
