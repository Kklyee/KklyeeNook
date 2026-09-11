import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type {
  AgentSessionSummary,
  CreateAgentSessionRequest,
  DeleteAgentSessionRequest,
  RenameAgentSessionRequest,
} from '@/shared/agent/agentSession'
import type { ChatRequest, ChatStreamEvent } from '@/shared/chat/chatEvent'
import type {
  ApprovalRequest,
  ApprovalResponse,
  DeletePermissionGrantRequest,
} from '@/shared/approval/approvalTypes'
import { AgentMessageSnapshot, LoadAgentMessagesRequest } from '../shared/chat/chatHistory'
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
  getAgentSettings(): Promise<AgentSettingsSnapshot>
  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): () => void
  onApprovalRequested(callback: (request: ApprovalRequest) => void): () => void
  respondApproval(response: ApprovalResponse): void
  deletePermissionGrant(request: DeletePermissionGrantRequest): Promise<void>
  createAgentSession(request: CreateAgentSessionRequest): Promise<AgentSessionSummary>
  listAgentSessions(): Promise<AgentSessionSummary[]>
  renameAgentSession(request: RenameAgentSessionRequest): Promise<AgentSessionSummary>
  deleteAgentSession(request: DeleteAgentSessionRequest): Promise<void>
  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]>
  listAgentExecutionRecords(
    request: LoadAgentExecutionRecordsRequest,
  ): Promise<AgentExecutionRecord[]>
  loadAgentMessages(request: LoadAgentMessagesRequest): Promise<AgentMessageSnapshot[]>
  saveAgentMessage(message: AgentMessageSnapshot): Promise<void>
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
