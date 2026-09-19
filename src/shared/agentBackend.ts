export interface AgentBackendInfo {
  baseUrl: string
}

export type AgentBackendStatus =
  | { state: 'starting' }
  | { state: 'ready'; info: AgentBackendInfo }
  | { state: 'unavailable'; message: string }
