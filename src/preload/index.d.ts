import type { ElectronAPI } from '@electron-toolkit/preload'
import type { PetState } from '@/shared/pet/petState'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { ChatRequest, ChatStreamEvent } from '@/shared/chat/chatEvent'
import type { ApprovalRequest, ApprovalResponse } from '@/shared/approval/approvalTypes'

interface API {
  getAgentSettings(): Promise<AgentSettingsSnapshot>
  onPetState(callback: (state: PetState) => void): () => void
  onAgentEvent(callback: (agentEvent: AgentEvent) => void): () => void
  submitPrompt(prompt: string): Promise<string>
  getWindowPosition(): Promise<[number, number]>
  setWindowPosition(x: number, y: number): void
  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): () => void
  onApprovalRequested(callback: (request: ApprovalRequest) => void): () => void
  respondApproval(response: ApprovalResponse): void
  createAgentSession(request: CreateAgentSessionRequest): Promise<AgentSessionSummary>
  listAgentSessions(): Promise<AgentSessionSummary[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
