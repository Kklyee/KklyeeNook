export interface AgentSessionSummary {
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  activeRunId?: string
}

export interface CreateAgentSessionRequest {
  title?: string
}

export interface RenameAgentSessionRequest {
  sessionId: string
  title: string
}

export interface DeleteAgentSessionRequest {
  sessionId: string
}
