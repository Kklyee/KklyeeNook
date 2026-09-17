export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

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

export type AgentConfig = {
  model: ModelConfig
  models?: SavedModelConfig[]
  activeModelId?: string
  providers?: ProviderConfig[]
  tools: ToolConfig
  cwd?: string
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
