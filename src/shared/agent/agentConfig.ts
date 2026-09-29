import type { McpServerConfig } from '../mcp/mcpServer'

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AgentModelSelection {
  provider: string
  modelID: string
  thinkingLevel: ThinkingLevel
}

export type ModelInput = 'text' | 'image'

export type ModelConfig = {
  modelID: string
  provider: string
  baseUrl?: string
  providerName?: string
  modelName?: string
  api?: string
  reasoning?: boolean
  input?: ModelInput[]
  contextWindow?: number
  maxTokens?: number
  thinkingLevel?: ThinkingLevel
}

export type SavedModelConfig = ModelConfig & { id: string }

export type ProviderModelConfig = {
  id: string
  name?: string
  api?: string
  reasoning?: boolean
  input?: ModelInput[]
  contextWindow?: number
  maxTokens?: number
}

export type ProviderConfig = {
  id: string
  name?: string
  baseUrl?: string
  api?: string
  models?: ProviderModelConfig[]
}

export type ToolConfig = { enabled: string[] }

export interface AgentCompactionSettings {
  enabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

export const DEFAULT_AGENT_COMPACTION_SETTINGS: AgentCompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
}

export type AgentConfig = {
  model: ModelConfig
  models?: SavedModelConfig[]
  activeModelId?: string
  providers?: ProviderConfig[]
  tools: ToolConfig
  compaction?: AgentCompactionSettings
  cwd?: string
  mcpServers?: McpServerConfig[]
}

export function getAgentCompactionSettings(config: AgentConfig): AgentCompactionSettings {
  return { ...DEFAULT_AGENT_COMPACTION_SETTINGS, ...config.compaction }
}

export function modelConfigId(provider: string, modelID: string): string {
  return `${provider}:${modelID}`
}

export function getSavedModels(config: AgentConfig): SavedModelConfig[] {
  return config.models?.length
    ? config.models
    : [{ ...config.model, id: modelConfigId(config.model.provider, config.model.modelID) }]
}

export function getActiveModel(config: AgentConfig): SavedModelConfig {
  const models = getSavedModels(config)
  return models.find((model) => model.id === config.activeModelId) ?? models[0]
}

export function updateAgentModelSelection(
  config: AgentConfig,
  selection: AgentModelSelection,
): AgentConfig {
  const models = getSavedModels(config)
  const selected = models.find(
    (model) => model.provider === selection.provider && model.modelID === selection.modelID,
  )
  if (!selected) throw new Error(`模型尚未配置: ${selection.provider}/${selection.modelID}`)

  const updatedModels = models.map((model) =>
    model.id === selected.id ? { ...model, thinkingLevel: selection.thinkingLevel } : model,
  )
  const activeModel = updatedModels.find((model) => model.id === selected.id) ?? selected

  return {
    ...config,
    models: updatedModels,
    activeModelId: activeModel.id,
    model: { ...activeModel },
  }
}

/**
 * Return provider-level settings, deriving a minimal provider list for older
 * configs that only stored model profiles.
 */
export function getConfiguredProviders(config: AgentConfig): ProviderConfig[] {
  if (config.providers) return structuredClone(config.providers)

  const providers = new Map<string, ProviderConfig>()
  for (const model of getSavedModels(config)) {
    const current = providers.get(model.provider) ?? { id: model.provider }
    providers.set(model.provider, {
      ...current,
      ...(model.providerName ? { name: model.providerName } : {}),
      ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
      ...(model.api ? { api: model.api } : {}),
    })
  }
  return [...providers.values()]
}
