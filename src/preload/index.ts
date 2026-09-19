import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentBackendStatus } from '@/shared/agentBackend'
import { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type {
  AgentSettingsSnapshot,
  DiscoverModelsRequest,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import type { ModelCatalogModel } from '@/shared/agent/agentSettings'
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
import type {
  ContextAttachmentRef,
  RemoveContextAttachmentRequest,
  StageContextAttachmentRequest,
} from '@/shared/context/contextAttachment'

const context = {
  stage(request: StageContextAttachmentRequest): Promise<ContextAttachmentRef> {
    return ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_ATTACHMENT_STAGE, request)
  },

  remove(request: RemoveContextAttachmentRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_ATTACHMENT_REMOVE, request)
  },
}

const api = {
  agentBackend: {
    getStatus(): Promise<AgentBackendStatus> {
      return ipcRenderer.invoke(IPC_CHANNELS.AGENT_BACKEND_GET_STATUS)
    },
    onStatus(listener: (status: AgentBackendStatus) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, status: AgentBackendStatus) =>
        listener(status)
      ipcRenderer.on(IPC_CHANNELS.AGENT_BACKEND_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_BACKEND_STATUS, handler)
    },
  },
  context,

  getAgentSettings(): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET)
  },

  updateAgentSettings(request: UpdateAgentSettingsRequest): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, request)
  },

  discoverModels(request: DiscoverModelsRequest): Promise<ModelCatalogModel[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_DISCOVER_MODELS, request)
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
