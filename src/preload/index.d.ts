import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type {
  AgentSessionSummary,
  CreateAgentSessionRequest,
  DeleteAgentSessionRequest,
  RenameAgentSessionRequest,
} from '@/shared/agent/agentSession'
import type { ChatRequest, ChatStreamEvent } from '@/shared/chat/chatEvent'
import type { ApprovalRequest, ApprovalResponse } from '@/shared/approval/approvalTypes'
import { AgentMessageSnapshot, LoadAgentMessagesRequest } from '../shared/chat/chatHistory'
import type { AgentRun, LoadAgentRunsRequest } from '../shared/agent/agentRun'

interface API {
  getAgentSettings(): Promise<AgentSettingsSnapshot>
  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): () => void
  onApprovalRequested(callback: (request: ApprovalRequest) => void): () => void
  respondApproval(response: ApprovalResponse): void
  createAgentSession(request: CreateAgentSessionRequest): Promise<AgentSessionSummary>
  listAgentSessions(): Promise<AgentSessionSummary[]>
  renameAgentSession(request: RenameAgentSessionRequest): Promise<AgentSessionSummary>
  deleteAgentSession(request: DeleteAgentSessionRequest): Promise<void>
  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]>
  loadAgentMessages(request: LoadAgentMessagesRequest): Promise<AgentMessageSnapshot[]>
  saveAgentMessage(message: AgentMessageSnapshot): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
