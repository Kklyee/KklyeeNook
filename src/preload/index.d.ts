import type { ElectronAPI } from '@electron-toolkit/preload'
import type { PiClient } from '@assistant-ui/react-pi'
import type {
  AgentSettingsSnapshot,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import type { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type { AgentRun, LoadAgentRunsRequest } from '../shared/agent/agentRun'
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
import type { ContextAwarePiClient } from '../shared/pi/piIpc'

interface API {
  pi: ContextAwarePiClient
  context: {
    stage(request: StageContextAttachmentRequest): Promise<ContextAttachmentRef>
    remove(request: RemoveContextAttachmentRequest): Promise<void>
  }
  getAgentSettings(): Promise<AgentSettingsSnapshot>
  updateAgentSettings(request: UpdateAgentSettingsRequest): Promise<AgentSettingsSnapshot>
  selectAgentWorkspace(): Promise<string | null>
  deletePermissionGrant(request: DeletePermissionGrantRequest): Promise<void>
  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]>
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
