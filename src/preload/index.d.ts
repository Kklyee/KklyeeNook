import type { ElectronAPI } from '@electron-toolkit/preload'
import type { PetState } from '@/shared/pet/petState'

interface API {
  onPetState(callback: (state: PetState) => void): () => void
  onAgentEvent(callback: (agentEvent: AgentEvent) => void): () => void
  submitPrompt(prompt: string): Promise<string>
  getWindowPosition(): Promise<[number, number]>
  setWindowPosition(x: number, y: number): void
  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): () => void
  onApprovalRequested(callback: (request: ApprovalRequest) => void): () => void
  respondApproval(response: ApprovalResponse): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
