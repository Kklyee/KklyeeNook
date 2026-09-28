import type { AgentConfig } from '@/shared/agent/agentConfig'
import type { LoadAgentExecutionRecordsRequest } from '@/shared/agent/agentExecutionRecord'
import type { LoadAgentRunsRequest } from '@/shared/agent/agentRun'
import type { AgentBackendInfo } from '@/shared/agentBackend'
import type { ResolvedContextAttachment } from '@/main/context/contextAttachmentService'

export type { AgentBackendInfo, AgentBackendStatus } from '@/shared/agentBackend'

export interface AgentBackendInitOptions {
  config: AgentConfig
  apiKeys: Record<string, string>
  databaseUrl: string
  migrationsPath: string
  sessionDir: string
  allowedOrigins: string[]
}

export type AgentBackendStartupStage =
  | 'process_spawned'
  | 'database_connected'
  | 'sessions_restored'
  | 'runs_restored'
  | 'http_server_listening'
  | 'ready'

export type AgentBackendRequest =
  | { action: 'settings:prepare' }
  | { action: 'settings:commit'; config: AgentConfig; apiKeys: Record<string, string> }
  | { action: 'settings:cancel' }
  | { action: 'context:stage'; attachment: ResolvedContextAttachment }
  | { action: 'context:remove'; id: string }
  | { action: 'context:clear' }
  | { action: 'agent-run:list'; request: LoadAgentRunsRequest }
  | { action: 'agent-run:overview-list' }
  | { action: 'agent-execution-record:list'; request: LoadAgentExecutionRecordsRequest }

export type MainToAgentBackendMessage =
  | { type: 'initialize'; options: AgentBackendInitOptions }
  | ({ type: 'request'; id: string } & AgentBackendRequest)
  | { type: 'shutdown' }

export type AgentBackendToMainMessage =
  | { type: 'startup-stage'; stage: AgentBackendStartupStage; detail?: string }
  | { type: 'ready'; info: AgentBackendInfo }
  | { type: 'failed'; message: string }
  | { type: 'response'; id: string; ok: true; value?: unknown }
  | { type: 'response'; id: string; ok: false; message: string }
