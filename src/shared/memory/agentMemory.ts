export type AgentMemoryScope = 'global' | 'workspace'

export interface AgentMemory {
  workspaceId?: string
  id: string
  scope: AgentMemoryScope
  content: string
  createdAt: number
  updatedAt: number
}

export interface DeleteAgentMemoryRequest {
  id: string
}
