export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export type ModelConfig = {
  modelID: string
  provider: string
  baseUrl?: string
  providerName?: string
  contextWindow?: number
  maxTokens?: number
  thinkingLevel?: ThinkingLevel
}

export type SavedModelConfig = ModelConfig & { id: string }

export type ToolConfig = { enabled: string[] }

export type AgentConfig = {
  model: ModelConfig
  models?: SavedModelConfig[]
  activeModelId?: string
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
