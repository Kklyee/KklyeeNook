import type { PermissionMode } from '@/shared/approval/permission'
import type { AgentConfig } from '@/shared/agent/agentConfig'
import type { LoadAgentExecutionRecordsRequest } from '@/shared/agent/agentExecutionRecord'
import type { LoadAgentRunsRequest } from '@/shared/agent/agentRun'
import type { AgentBackendInfo, AgentBackendNotification } from '@/shared/agentBackend'
import type { ResolvedContextAttachment } from '@/main/context/contextAttachmentService'
import type {
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput,
} from '@/shared/scheduler/scheduledTask'
import type { UpdateAgentModelSelectionRequest } from '@/shared/agent/agentSettings'
import type { KnowledgeSearchRequest, KnowledgeSource } from '@/shared/knowledge/knowledge'

export type { AgentBackendInfo, AgentBackendNotification, AgentBackendStatus } from '@/shared/agentBackend'

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
  | { action: 'conversation:permission'; id: string; mode: PermissionMode }
  | { action: 'conversation:list' }
  | { action: 'conversation:create'; title?: string; workspaceId: string | null }
  | { action: 'conversation:move'; id: string; workspaceId: string | null }
  | { action: 'workspace:list' }
  | { action: 'workspace:attach'; path: string; relinkId?: string; createNew?: boolean }
  | { action: 'workspace:detach'; id: string }
  | { action: 'knowledge:list' }
  | { action: 'knowledge:add'; path: string; kind: KnowledgeSource['kind']; workspaceId?: string }
  | { action: 'knowledge:reindex'; sourceId: string }
  | { action: 'knowledge:remove'; sourceId: string }
  | { action: 'knowledge:search'; input: KnowledgeSearchRequest }
  | { action: 'knowledge:read'; chunkId: string }
  | { action: 'settings:prepare' }
  | { action: 'settings:commit'; config: AgentConfig; apiKeys: Record<string, string> }
  | { action: 'settings:cancel' }
  | { action: 'settings:model-selection'; selection: UpdateAgentModelSelectionRequest }
  | { action: 'mcp:list' }
  | { action: 'mcp:connect'; serverId: string }
  | { action: 'mcp:disconnect'; serverId: string }
  | { action: 'mcp:retry'; serverId: string }
  | { action: 'context:stage'; attachment: ResolvedContextAttachment }
  | { action: 'context:remove'; id: string }
  | { action: 'context:clear' }
  | { action: 'skills:list' }
  | { action: 'skills:get'; id: string }
  | { action: 'skills:reload' }
  | { action: 'agent-run:list'; request: LoadAgentRunsRequest }
  | { action: 'agent-run:overview-list' }
  | { action: 'agent-execution-record:list'; request: LoadAgentExecutionRecordsRequest }
  | { action: 'scheduled-task:list' }
  | { action: 'scheduled-task:create'; input: CreateScheduledTaskInput }
  | { action: 'scheduled-task:update'; id: string; input: UpdateScheduledTaskInput }
  | { action: 'scheduled-task:delete'; id: string }
  | { action: 'scheduled-task:enable'; id: string }
  | { action: 'scheduled-task:disable'; id: string }

export type MainToAgentBackendMessage =
  | { type: 'initialize'; options: AgentBackendInitOptions }
  | ({ type: 'request'; id: string } & AgentBackendRequest)
  | { type: 'shutdown' }

export type AgentBackendToMainMessage =
  | { type: 'startup-stage'; stage: AgentBackendStartupStage; detail?: string }
  | { type: 'ready'; info: AgentBackendInfo }
  | { type: 'failed'; message: string }
  | { type: 'notification'; notification: AgentBackendNotification }
  | { type: 'response'; id: string; ok: true; value?: unknown }
  | { type: 'response'; id: string; ok: false; message: string }
