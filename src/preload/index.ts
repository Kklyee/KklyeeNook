import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { KnowledgeReadResult, KnowledgeSearchRequest, KnowledgeSearchResult, KnowledgeSource } from '@/shared/knowledge/knowledge'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentBackendStatus } from '@/shared/agentBackend'
import type { AgentSkill } from '@/shared/agent/agentSkill'
import type { AgentMemory, DeleteAgentMemoryRequest } from '@/shared/memory/agentMemory'
import { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type {
  AgentSettingsSnapshot,
  DiscoverModelsRequest,
  UpdateAgentModelSelectionRequest,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import type { ModelCatalogModel } from '@/shared/agent/agentSettings'
import type { McpServerState } from '@/shared/mcp/mcpServer'
import type { AgentRun, AgentRunOverview, LoadAgentRunsRequest } from '@/shared/agent/agentRun'
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
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  UpdateScheduledTaskInput,
} from '@/shared/scheduler/scheduledTask'

const context = {
  stage(request: StageContextAttachmentRequest): Promise<ContextAttachmentRef> {
    return ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_ATTACHMENT_STAGE, request)
  },

  remove(request: RemoveContextAttachmentRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_ATTACHMENT_REMOVE, request)
  },
}

const api = {
  knowledge: {
    list(): Promise<KnowledgeSource[]> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_LIST) },
    add(path: string, kind: KnowledgeSource['kind']): Promise<KnowledgeSource> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_ADD, { path, kind }) },
    pick(kind: KnowledgeSource['kind']): Promise<KnowledgeSource[]> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_PICK, kind) },
    reindex(sourceId: string): Promise<void> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_REINDEX, sourceId) },
    remove(sourceId: string): Promise<void> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_REMOVE, sourceId) },
    search(input: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_SEARCH, input) },
    read(chunkId: string): Promise<KnowledgeReadResult> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_READ, chunkId) },
    open(chunkId: string): Promise<void> { return ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_OPEN, chunkId) },
    droppedFilePath(file: File): string { return webUtils.getPathForFile(file) },
  },
  window: {
    minimize(): void {
      ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE)
    },
    toggleMaximize(): void {
      ipcRenderer.send(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE)
    },
    isMaximized(): Promise<boolean> {
      return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
    },
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
      ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, handler)
    },
    close(): void {
      ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
    },
  },
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
  listAgentSkills(): Promise<AgentSkill[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SKILLS_LIST)
  },

  getAgentSkill(id: string): Promise<AgentSkill | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SKILLS_GET, id)
  },

  reloadAgentSkills(): Promise<AgentSkill[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SKILLS_RELOAD)
  },
  listScheduledTasks(): Promise<ScheduledTask[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_TASK_LIST)
  },
  createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_TASK_CREATE, input)
  },
  updateScheduledTask(id: string, input: UpdateScheduledTaskInput): Promise<ScheduledTask> {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_TASK_UPDATE, { id, input })
  },
  deleteScheduledTask(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_TASK_DELETE, id)
  },
  enableScheduledTask(id: string): Promise<ScheduledTask> {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_TASK_ENABLE, id)
  },
  disableScheduledTask(id: string): Promise<ScheduledTask> {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEDULED_TASK_DISABLE, id)
  },
  context,

  getAgentSettings(): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET)
  },

  updateAgentSettings(request: UpdateAgentSettingsRequest): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, request)
  },

  updateAgentModelSelection(
    request: UpdateAgentModelSelectionRequest,
  ): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE_MODEL_SELECTION, request)
  },

  discoverModels(request: DiscoverModelsRequest): Promise<ModelCatalogModel[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_DISCOVER_MODELS, request)
  },

  selectAgentWorkspace(): Promise<string | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SELECT_WORKSPACE)
  },

  listMcpServers(): Promise<McpServerState[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST)
  },

  connectMcpServer(serverId: string): Promise<McpServerState> {
    return ipcRenderer.invoke(IPC_CHANNELS.MCP_CONNECT, serverId)
  },

  disconnectMcpServer(serverId: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.MCP_DISCONNECT, serverId)
  },

  retryMcpServer(serverId: string): Promise<McpServerState> {
    return ipcRenderer.invoke(IPC_CHANNELS.MCP_RETRY, serverId)
  },

  listMemories(): Promise<AgentMemory[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_LIST)
  },

  deleteMemory(request: DeleteAgentMemoryRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_DELETE, request)
  },

  deletePermissionGrant(request: DeletePermissionGrantRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.PERMISSION_GRANT_DELETE, request)
  },

  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_LIST, request)
  },

  listAgentRunOverviews(): Promise<AgentRunOverview[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUN_OVERVIEW_LIST)
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
