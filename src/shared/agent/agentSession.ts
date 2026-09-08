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
