export interface AgentSessionSummary {
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  activeRunId?: string
}
