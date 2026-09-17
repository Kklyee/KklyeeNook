import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  getActiveModel,
  getSavedModels,
  modelConfigId,
  type AgentConfig,
} from '@/shared/agent/agentConfig'

const DEFAULT_CONFIG: AgentConfig = {
  model: { provider: 'anthropic', modelID: '...', thinkingLevel: 'medium' },

  tools: { enabled: ['read', 'bash', 'edit', 'write'] },
}

export class AgentConfigStore {
  private config: AgentConfig

  constructor(
    config?: Partial<AgentConfig>,
    private readonly storagePath?: string,
  ) {
    const persisted = this.load()
    const initial = mergeConfig(config)
    this.config = persisted
      ? mergeConfig({
          ...initial,
          ...persisted,
          model: { ...initial.model, ...persisted.model },
          tools: { ...initial.tools, ...persisted.tools },
        })
      : initial
  }

  get(): AgentConfig {
    return structuredClone(this.config)
  }

  set(config: AgentConfig): void {
    const next = mergeConfig(config)
    this.persist(next)
    this.config = next
  }

  private load(): AgentConfig | undefined {
    if (!this.storagePath || !existsSync(this.storagePath)) return undefined
    try {
      const value: unknown = JSON.parse(readFileSync(this.storagePath, 'utf8'))
      return isAgentConfig(value) ? value : undefined
    } catch (error) {
      console.warn('[AgentConfigStore] failed to load persisted settings:', error)
      return undefined
    }
  }

  private persist(config: AgentConfig): void {
    if (!this.storagePath) return
    mkdirSync(dirname(this.storagePath), { recursive: true })
    writeFileSync(this.storagePath, JSON.stringify(config, null, 2), 'utf8')
  }
}

function mergeConfig(config?: Partial<AgentConfig>): AgentConfig {
  const merged: AgentConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    model: { ...DEFAULT_CONFIG.model, ...config?.model },
    tools: { ...DEFAULT_CONFIG.tools, ...config?.tools },
  }
  merged.models = getSavedModels(merged)
  const savedActive = merged.models.find((model) => model.id === merged.activeModelId)
  if (
    savedActive &&
    (savedActive.provider !== merged.model.provider || savedActive.modelID !== merged.model.modelID)
  ) {
    const replacement = {
      ...merged.model,
      id: modelConfigId(merged.model.provider, merged.model.modelID),
    }
    merged.models = merged.models.map((model) =>
      model.id === savedActive.id ? replacement : model,
    )
    merged.activeModelId = replacement.id
  }
  merged.activeModelId = getActiveModel(merged).id
  merged.model = { ...getActiveModel(merged) }
  delete (merged.model as Partial<{ id: string }>).id
  return merged
}

function isAgentConfig(value: unknown): value is AgentConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<AgentConfig>
  return Boolean(
    config.model &&
    isModelConfig(config.model) &&
    (config.models === undefined ||
      (Array.isArray(config.models) &&
        config.models.length > 0 &&
        config.models.every((model) =>
          Boolean(model && typeof model.id === 'string' && isModelConfig(model)),
        ))) &&
    (config.providers === undefined ||
      (Array.isArray(config.providers) &&
        config.providers.every((provider) => isProviderConfig(provider)))) &&
    (config.activeModelId === undefined || typeof config.activeModelId === 'string') &&
    config.tools &&
    Array.isArray(config.tools.enabled) &&
    config.tools.enabled.every((name) => typeof name === 'string') &&
    (config.cwd === undefined || typeof config.cwd === 'string'),
  )
}

function isProviderConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const provider = value as {
    id?: unknown
    name?: unknown
    baseUrl?: unknown
    api?: unknown
    models?: unknown
  }
  return Boolean(
    typeof provider.id === 'string' &&
    (provider.name === undefined || typeof provider.name === 'string') &&
    (provider.baseUrl === undefined || typeof provider.baseUrl === 'string') &&
    (provider.api === undefined || typeof provider.api === 'string') &&
    (provider.models === undefined ||
      (Array.isArray(provider.models) &&
        provider.models.every((model) => isProviderModelConfig(model)))),
  )
}

function isProviderModelConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const model = value as {
    id?: unknown
    name?: unknown
    api?: unknown
    reasoning?: unknown
    input?: unknown
    contextWindow?: unknown
    maxTokens?: unknown
  }
  return Boolean(
    typeof model.id === 'string' &&
    (model.name === undefined || typeof model.name === 'string') &&
    (model.api === undefined || typeof model.api === 'string') &&
    (model.reasoning === undefined || typeof model.reasoning === 'boolean') &&
    (model.input === undefined ||
      (Array.isArray(model.input) &&
        model.input.length > 0 &&
        model.input.every((input) => input === 'text' || input === 'image'))) &&
    (model.contextWindow === undefined || isPositiveInteger(model.contextWindow)) &&
    (model.maxTokens === undefined || isPositiveInteger(model.maxTokens)),
  )
}

function isModelConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const model = value as Partial<AgentConfig['model']>
  return Boolean(
    typeof model.provider === 'string' &&
    typeof model.modelID === 'string' &&
    (model.baseUrl === undefined || typeof model.baseUrl === 'string') &&
    (model.providerName === undefined || typeof model.providerName === 'string') &&
    (model.modelName === undefined || typeof model.modelName === 'string') &&
    (model.api === undefined || typeof model.api === 'string') &&
    (model.reasoning === undefined || typeof model.reasoning === 'boolean') &&
    (model.input === undefined ||
      (Array.isArray(model.input) &&
        model.input.length > 0 &&
        model.input.every((input) => input === 'text' || input === 'image'))) &&
    (model.contextWindow === undefined || isPositiveInteger(model.contextWindow)) &&
    (model.maxTokens === undefined || isPositiveInteger(model.maxTokens)) &&
    (model.thinkingLevel === undefined ||
      ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(model.thinkingLevel)),
  )
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
