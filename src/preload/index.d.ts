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

interface API {
  pi: PiClient
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
