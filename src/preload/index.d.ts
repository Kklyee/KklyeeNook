import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AgentSettingsSnapshot,
  DiscoverModelsRequest,
  ModelCatalogModel,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import type { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type { AgentRun, AgentRunOverview, LoadAgentRunsRequest } from '../shared/agent/agentRun'
import type {
  AgentExecutionRecord,
  LoadAgentExecutionRecordsRequest,
} from '../shared/agent/agentExecutionRecord'
import type {
  ApplyArtifactRequest,
  Artifact,
  ArtifactActionResult,
  ExportArtifactRequest,
  ListArtifactsRequest,
} from '../shared/artifact/artifact'
import type {
  ContextAttachmentRef,
  RemoveContextAttachmentRequest,
  StageContextAttachmentRequest,
} from '../shared/context/contextAttachment'
import type { AgentBackendStatus } from '../shared/agentBackend'
import type { AgentSkill } from '../shared/agent/agentSkill'
import type { AgentMemory, DeleteAgentMemoryRequest } from '../shared/memory/agentMemory'

interface API {
  window: {
    minimize(): void
    toggleMaximize(): void
    isMaximized(): Promise<boolean>
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void
    close(): void
  }
  agentBackend: {
    getStatus(): Promise<AgentBackendStatus>
    onStatus(listener: (status: AgentBackendStatus) => void): () => void
  }
  listAgentSkills(): Promise<AgentSkill[]>
  getAgentSkill(id: string): Promise<AgentSkill | null>
  reloadAgentSkills(): Promise<AgentSkill[]>
  context: {
    stage(request: StageContextAttachmentRequest): Promise<ContextAttachmentRef>
    remove(request: RemoveContextAttachmentRequest): Promise<void>
  }
  getAgentSettings(): Promise<AgentSettingsSnapshot>
  updateAgentSettings(request: UpdateAgentSettingsRequest): Promise<AgentSettingsSnapshot>
  discoverModels(request: DiscoverModelsRequest): Promise<ModelCatalogModel[]>
  selectAgentWorkspace(): Promise<string | null>
  listMemories(): Promise<AgentMemory[]>
  deleteMemory(request: DeleteAgentMemoryRequest): Promise<void>
  deletePermissionGrant(request: DeletePermissionGrantRequest): Promise<void>
  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]>
  listAgentRunOverviews(): Promise<AgentRunOverview[]>
  listAgentExecutionRecords(
    request: LoadAgentExecutionRecordsRequest,
  ): Promise<AgentExecutionRecord[]>
  listArtifacts(request: ListArtifactsRequest): Promise<Artifact[]>
  applyArtifact(request: ApplyArtifactRequest): Promise<ArtifactActionResult>
  exportArtifact(request: ExportArtifactRequest): Promise<ArtifactActionResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
