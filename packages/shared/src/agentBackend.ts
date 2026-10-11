export interface AgentBackendInfo {
  baseUrl: string
}

export interface AgentBackendNotification {
  title: string
  body: string
}

export type AgentBackendStatus =
  | { state: 'starting' }
  | { state: 'ready'; info: AgentBackendInfo }
  | { state: 'unavailable'; message: string }
