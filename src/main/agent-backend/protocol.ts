import type { AgentConfig } from '@/shared/agent/agentConfig'
import type { LoadAgentExecutionRecordsRequest } from '@/shared/agent/agentExecutionRecord'
import type { LoadAgentRunsRequest } from '@/shared/agent/agentRun'
import type { AgentBackendInfo } from '@/shared/agentBackend'
import type { ResolvedContextAttachment } from '@/main/context/contextAttachmentService'
import type { PiClientCall, PiSubscribeRequest } from '@/shared/pi/piIpc'
import type { PiClientEvent } from '@assistant-ui/react-pi'

export type { AgentBackendInfo, AgentBackendStatus } from '@/shared/agentBackend'

export interface AgentBackendInitOptions {
  config: AgentConfig
  apiKeys: Record<string, string>
  databaseUrl: string
  migrationsPath: string
  sessionDir: string
  allowedOrigins: string[]
  transport: AgentBackendInfo['transport']
}

export type AgentBackendRequest =
  | { action: 'settings:prepare' }
  | { action: 'settings:commit'; config: AgentConfig; apiKeys: Record<string, string> }
  | { action: 'settings:cancel' }
  | { action: 'context:stage'; attachment: ResolvedContextAttachment }
  | { action: 'context:remove'; id: string }
  | { action: 'context:clear' }
  | { action: 'agent-run:list'; request: LoadAgentRunsRequest }
  | { action: 'agent-execution-record:list'; request: LoadAgentExecutionRecordsRequest }
  | { action: 'pi:call'; call: PiClientCall }

export type MainToAgentBackendMessage =
  | { type: 'initialize'; options: AgentBackendInitOptions }
  | ({ type: 'request'; id: string } & AgentBackendRequest)
  | { type: 'pi:subscribe'; subscriptionId: string; request: PiSubscribeRequest }
  | { type: 'pi:unsubscribe'; subscriptionId: string }
  | { type: 'shutdown' }

export type AgentBackendToMainMessage =
  | { type: 'ready'; info: AgentBackendInfo }
  | { type: 'failed'; message: string }
  | { type: 'response'; id: string; ok: true; value?: unknown }
  | { type: 'response'; id: string; ok: false; message: string }
  | { type: 'pi:event'; subscriptionId: string; event: PiClientEvent }
