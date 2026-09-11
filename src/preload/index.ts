import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { ChatRequest, ChatStreamEvent } from '@/shared/chat/chatEvent'
import {
  ApprovalRequest,
  ApprovalResponse,
  DeletePermissionGrantRequest,
} from '@/shared/approval/approvalTypes'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import {
  AgentSessionSummary,
  CreateAgentSessionRequest,
  DeleteAgentSessionRequest,
  RenameAgentSessionRequest,
} from '@/shared/agent/agentSession'
import { AgentMessageSnapshot, LoadAgentMessagesRequest } from '@/shared/chat/chatHistory'
import { AgentRun, LoadAgentRunsRequest } from '@/shared/agent/agentRun'
import type {
  AgentExecutionRecord,
  LoadAgentExecutionRecordsRequest,
} from '@/shared/agent/agentExecutionRecord'
import type {
  ApplyArtifactRequest,
  Artifact,
  ArtifactActionResult,
  ExportArtifactRequest,
  ListArtifactsRequest,
} from '@/shared/artifact/artifact'

const api = {
  getAgentSettings(): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET)
  },

  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void) {
    const { port1, port2 } = new MessageChannel()

    const handleMessage = (event: MessageEvent<ChatStreamEvent>) => {
      onEvent(event.data)
    }
    port1.addEventListener('message', handleMessage)
    port1.start()
    ipcRenderer.postMessage(IPC_CHANNELS.ASSISTANT_STREAM, request, [port2])

    let stopped = false

    return () => {
      if (stopped) return
      stopped = true
      port1.removeEventListener('message', handleMessage)
      port1.close()
    }
  },

  onApprovalRequested(callback: (request: ApprovalRequest) => void) {
    const listener = (_event: IpcRendererEvent, request: ApprovalRequest) => {
      callback(request)
    }

    ipcRenderer.on(IPC_CHANNELS.APPROVAL_REQUEST, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.APPROVAL_REQUEST, listener)
    }
  },

  respondApproval(response: ApprovalResponse) {
    ipcRenderer.send(IPC_CHANNELS.APPROVAL_RESPOND, response)
  },

  deletePermissionGrant(request: DeletePermissionGrantRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.PERMISSION_GRANT_DELETE, request)
  },

  createAgentSession(request: CreateAgentSessionRequest): Promise<AgentSessionSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_CREATE, request)
  },

  listAgentSessions(): Promise<AgentSessionSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_LIST)
  },

  renameAgentSession(request: RenameAgentSessionRequest): Promise<AgentSessionSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_RENAME, request)
  },

  deleteAgentSession(request: DeleteAgentSessionRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_DELETE, request)
  },

  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_LIST, request)
  },

  listAgentExecutionRecords(
    request: LoadAgentExecutionRecordsRequest,
  ): Promise<AgentExecutionRecord[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_EXECUTION_RECORD_LIST, request)
  },

  loadAgentMessages(request: LoadAgentMessagesRequest): Promise<AgentMessageSnapshot[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_MESSAGE_LIST, request)
  },

  saveAgentMessage(message: AgentMessageSnapshot): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_MESSAGE_SAVE, message)
  },

  listArtifacts(request: ListArtifactsRequest): Promise<Artifact[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_LIST, request)
  },

  applyArtifact(request: ApplyArtifactRequest): Promise<ArtifactActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_APPLY, request)
  },

  exportArtifact(request: ExportArtifactRequest): Promise<ArtifactActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_EXPORT, request)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
