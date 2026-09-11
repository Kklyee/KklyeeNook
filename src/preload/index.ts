import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { PiClient, PiClientEvent } from '@assistant-ui/react-pi'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type {
  AgentSettingsSnapshot,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
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

const pi = {
  listThreads: (input) => ipcRenderer.invoke(IPC_CHANNELS.PI_THREAD_LIST, input),
  createThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.PI_THREAD_CREATE, input),
  getThread: (threadId) => ipcRenderer.invoke(IPC_CHANNELS.PI_THREAD_GET, { threadId }),
  sendMessage: (threadId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.PI_MESSAGE_SEND, { threadId, input }),
  cancelRun: (threadId) => ipcRenderer.invoke(IPC_CHANNELS.PI_RUN_CANCEL, { threadId }),
  clearQueue: (threadId) => ipcRenderer.invoke(IPC_CHANNELS.PI_QUEUE_CLEAR, { threadId }),
  getAvailableModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.PI_MODEL_LIST, input),
  setModel: (threadId, input) => ipcRenderer.invoke(IPC_CHANNELS.PI_MODEL_SET, { threadId, input }),
  setThinkingLevel: (threadId, level) =>
    ipcRenderer.invoke(IPC_CHANNELS.PI_THINKING_SET, { threadId, level }),
  renameThread: (threadId, title) =>
    ipcRenderer.invoke(IPC_CHANNELS.PI_THREAD_RENAME, { threadId, title }),
  archiveThread: (threadId) => ipcRenderer.invoke(IPC_CHANNELS.PI_THREAD_ARCHIVE, { threadId }),
  unarchiveThread: (threadId) => ipcRenderer.invoke(IPC_CHANNELS.PI_THREAD_UNARCHIVE, { threadId }),
  deleteThread: (threadId) => ipcRenderer.invoke(IPC_CHANNELS.PI_THREAD_DELETE, { threadId }),
  respondToHostUiRequest: (threadId, response) =>
    ipcRenderer.invoke(IPC_CHANNELS.PI_HOST_UI_RESPOND, { threadId, response }),
  subscribe(threadId, listener, options) {
    const { port1, port2 } = new MessageChannel()
    const handleMessage = (event: MessageEvent<PiClientEvent>) => listener(event.data)
    port1.addEventListener('message', handleMessage)
    port1.start()
    ipcRenderer.postMessage(IPC_CHANNELS.PI_THREAD_SUBSCRIBE, { threadId, options }, [port2])
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      port1.removeEventListener('message', handleMessage)
      port1.close()
    }
  },
} satisfies PiClient

const api = {
  pi,

  getAgentSettings(): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET)
  },

  updateAgentSettings(request: UpdateAgentSettingsRequest): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, request)
  },

  selectAgentWorkspace(): Promise<string | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SELECT_WORKSPACE)
  },

  deletePermissionGrant(request: DeletePermissionGrantRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.PERMISSION_GRANT_DELETE, request)
  },

  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_LIST, request)
  },

  listAgentExecutionRecords(
    request: LoadAgentExecutionRecordsRequest,
  ): Promise<AgentExecutionRecord[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_EXECUTION_RECORD_LIST, request)
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
