import { ipcMain } from 'electron'

import type { LoadAgentExecutionRecordsRequest } from '@/shared/agent/agentExecutionRecord'
import type { LoadAgentRunsRequest } from '@/shared/agent/agentRun'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentBackendProcess } from '../../agent-backend/process'

export function registerAgentRunIpc(backend: AgentBackendProcess): () => void {
  ipcMain.handle(IPC_CHANNELS.AGENT_RUN_LIST, (_event, request: LoadAgentRunsRequest) =>
    backend.request({ action: 'agent-run:list', request }),
  )
  ipcMain.handle(IPC_CHANNELS.AGENT_RUN_OVERVIEW_LIST, () =>
    backend.request({ action: 'agent-run:overview-list' }),
  )
  ipcMain.handle(
    IPC_CHANNELS.AGENT_EXECUTION_RECORD_LIST,
    (_event, request: LoadAgentExecutionRecordsRequest) =>
      backend.request({ action: 'agent-execution-record:list', request }),
  )
  ipcMain.handle(IPC_CHANNELS.TOOL_RESULT_READ, (_event, resultRef: string) =>
    backend.request({ action: 'tool-result:read', resultRef }),
  )
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.TOOL_RESULT_READ)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_RUN_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_RUN_OVERVIEW_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_EXECUTION_RECORD_LIST)
  }
}
