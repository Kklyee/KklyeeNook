import type { PermissionMode } from '../approval/permission'
import type { PermissionGrant } from '../approval/approvalTypes'
import type {
  AgentCompactionSettings,
  ProviderConfig,
  ProviderModelConfig,
  SavedModelConfig,
  ThinkingLevel,
} from './agentConfig'
import type { ModelInput } from './agentConfig'
import type { McpServerConfig } from '../mcp/mcpServer'
import type { KnowledgeSettings } from '../knowledge/knowledge'

export interface ModelCatalogProvider {
  id: string
  name: string
  builtin?: boolean
  models: ModelCatalogModel[]
}

export interface ModelCatalogModel {
  id: string
  name: string
  api?: string
  reasoning: boolean
  input: ModelInput[]
  availableThinkingLevels: ThinkingLevel[]
  contextWindow: number
  maxTokens: number
  builtin?: boolean
}

export interface SavedModelSettings extends SavedModelConfig {
  providerName: string
  modelName: string
  hasApiKey: boolean
}

export interface SavedProviderSettings extends ProviderConfig {
  name: string
  models: ProviderModelConfig[]
  builtin: boolean
  hasApiKey: boolean
}

// Only public configuration crosses IPC. API keys stay in the main process.
export interface AgentSettingsSnapshot {
  provider: string
  modelID: string
  baseUrl?: string
  providerName?: string
  contextWindow?: number
  maxTokens?: number
  thinkingLevel: string
  defaultPermissionMode?: PermissionMode
  hasApiKey: boolean
  models: SavedModelSettings[]
  providers?: SavedProviderSettings[]
  activeModelId: string
  catalog: ModelCatalogProvider[]
  credentialPersistenceAvailable: boolean
  tools: Array<{ name: string; requiresApproval: boolean }>
  permissionGrants: PermissionGrant[]
  compaction: AgentCompactionSettings
  mcpServers: McpServerConfig[]
  knowledge?: KnowledgeSettings
}

export interface UpdateAgentSettingsRequest {
  defaultPermissionMode?: PermissionMode
  providers?: ProviderConfig[]
  /** Legacy model-profile update shape. */
  models?: SavedModelConfig[]
  activeModelId?: string
  credential?: { provider: string; apiKey?: string; deleteApiKey?: boolean }
  compaction?: AgentCompactionSettings
  mcpServers?: McpServerConfig[]
  knowledge?: KnowledgeSettings
}

export interface DiscoverModelsRequest {
  provider: string
  baseUrl?: string
  api?: string
  apiKey?: string
}

export interface UpdateAgentModelSelectionRequest {
  provider: string
  modelId: string
  thinkingLevel: ThinkingLevel
}
