export interface Workspace {
  id: string
  displayName: string
  rootPath?: string
  lastKnownPath?: string
  status: 'attached' | 'detached' | 'missing'
  fsDevice?: string
  fsInode?: string
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number
}

export interface WorkspaceAttachResult {
  workspace?: Workspace
  path?: string
  candidates?: Workspace[]
}

export interface AgentExecutionContext {
  conversationId: string
  workspaceId?: string
  workspace?: { id: string; rootPath: string }
}
