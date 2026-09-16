export interface AgentBackendInfo {
  baseUrl: string
  transport: 'http' | 'ipc'
}

export type AgentBackendStatus =
  | { state: 'starting' }
  | { state: 'ready'; info: AgentBackendInfo }
  | { state: 'unavailable'; message: string }
