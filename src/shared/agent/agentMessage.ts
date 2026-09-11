export type AgentMessageRole = 'user' | 'assistant' | 'system'

export interface AgentMessageProjection {
  id: string
  sessionId: string
  parentId: string | null
  role: AgentMessageRole
  createdAt: number
  payload: unknown
}
