import type { PermissionGrant } from '../approval/approvalTypes'
import type { SavedModelConfig, ThinkingLevel } from './agentConfig'

export interface ModelCatalogProvider {
  id: string
  name: string
  models: ModelCatalogModel[]
}

export interface ModelCatalogModel {
  id: string
  name: string
  reasoning: boolean
  contextWindow: number
  maxTokens: number
}

export interface SavedModelSettings extends SavedModelConfig {
  providerName: string
  modelName: string
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
  cwd: string
  hasApiKey: boolean
  models: SavedModelSettings[]
  activeModelId: string
  catalog: ModelCatalogProvider[]
  credentialPersistenceAvailable: boolean
  tools: Array<{ name: string; requiresApproval: boolean }>
  permissionGrants: PermissionGrant[]
}

export interface UpdateAgentSettingsRequest {
  models: SavedModelConfig[]
  activeModelId: string
  cwd: string
  credential?: { provider: string; apiKey?: string; deleteApiKey?: boolean }
}

export interface SwitchThreadModelRequest {
  provider: string
  modelId: string
  thinkingLevel: ThinkingLevel
}
