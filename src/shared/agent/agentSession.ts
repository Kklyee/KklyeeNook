export interface AgentSessionSummary {
  workspaceId?: string | null
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  activeRunId?: string
}
