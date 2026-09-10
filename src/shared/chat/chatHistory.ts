export type ChatHistoryRole = 'user' | 'assistant' | 'system'

export interface AgentMessageSnapshot {
  id: string
  sessionId: string
  parentId: string | null
  role: ChatHistoryRole
  createdAt: number

  // assistant-ui message 除 id / role / createdAt 之外的数据
  payload: unknown
  runConfig?: unknown
}

export interface LoadAgentMessagesRequest {
  sessionId: string
}
