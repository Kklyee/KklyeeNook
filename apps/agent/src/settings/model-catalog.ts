import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import { applicationProviders } from './model-providers'
import type { ModelCatalogProvider } from '@kklyeenook/shared/agent/agentSettings'
import {
  getConfiguredProviders,
  getSavedModels,
  updateAgentModelSelection,
} from '@kklyeenook/shared/agent/agentConfig'
import type {
  AgentConfig,
  AgentModelSelection,
  ProviderConfig,
  ProviderModelConfig,
  SavedModelConfig,
  ThinkingLevel,
} from '@kklyeenook/shared/agent/agentConfig'
import { resolveModelInput } from '@kklyeenook/shared/agent/modelCapabilities'

const builtins = createModels()
for (const provider of applicationProviders()) builtins.setProvider(provider)
const UI_THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

const isUiThinkingLevel = (level: string): level is ThinkingLevel =>
  UI_THINKING_LEVELS.some((candidate) => candidate === level)

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 16_384

function normalizedModelId(id: string): string {
  const normalized = id.trim().toLowerCase().split('/').at(-1)!
  return ['deepseek-v4.1-flash', 'deepseek-v41-flash', 'deepseek-v4-1-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(normalized)
    ? 'deepseek-flash'
    : normalized
}

export function findBuiltinModel(provider: string, modelId: string): Model<Api> | undefined {
  const id = normalizedModelId(modelId)
  const matches = builtins.getModels().filter((model) => normalizedModelId(model.id) === id)
  return matches.find((model) => model.provider === provider)
    ?? matches.find((model) => id.startsWith(`${model.provider}-`))
    ?? matches[0]
}

export const unknownThinkingLevelMap = {
  minimal: null, low: null, medium: null, high: null, xhigh: null, max: null,
} as const

export function getModelThinkingLevels(provider: string, modelId: string, reasoning?: boolean): ThinkingLevel[] {
  const model = findBuiltinModel(provider, modelId)
  if (!model || reasoning === false) return ['off']
  return getSupportedThinkingLevels({ ...model, reasoning: reasoning ?? model.reasoning }).filter(isUiThinkingLevel)
}

export function getModelCatalog(): ModelCatalogProvider[] {
  return builtins
    .getProviders()
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      builtin: true,
      models: builtins
        .getModels(provider.id)
        .map((model) => ({
          id: model.id,
          name: model.name,
          api: model.api,
          reasoning: model.reasoning,
          input: resolveModelInput(provider.id, model.id, model.input),
          availableThinkingLevels: getSupportedThinkingLevels(model).filter(isUiThinkingLevel),
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          builtin: true,
        })),
    }))
    .filter((provider) => provider.models.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function hasBuiltinModel(provider: string, modelID: string): boolean {
  return builtins.getModel(provider, modelID) !== undefined
}

export function hasBuiltinProvider(provider: string): boolean {
  return builtins.getProvider(provider) !== undefined
}

/**
 * Add saved models that are not part of pi-ai's catalog to the public catalog.
 * This keeps the renderer able to edit and select a model after pi-ai has
 * fallen behind a provider's model release.
 */
export function mergeSavedModelsIntoCatalog(
  catalog: ModelCatalogProvider[],
  savedModels: readonly SavedModelConfig[],
): ModelCatalogProvider[] {
  const merged = catalog.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => ({ ...model })),
  }))

  for (const savedModel of savedModels) {
    let provider = merged.find((item) => item.id === savedModel.provider)
    if (!provider) {
      provider = {
        id: savedModel.provider,
        name: savedModel.providerName ?? savedModel.provider,
        builtin: false,
        models: [],
      }
      merged.push(provider)
    }

    if (provider.models.some((model) => model.id === savedModel.modelID)) continue

    const reasoning = savedModel.reasoning ?? findBuiltinModel(savedModel.provider, savedModel.modelID)?.reasoning ?? false
    const availableThinkingLevels = getModelThinkingLevels(savedModel.provider, savedModel.modelID, reasoning)

    provider.models.push({
      id: savedModel.modelID,
      name: savedModel.modelName ?? savedModel.modelID,
      ...(savedModel.api ? { api: savedModel.api } : {}),
      reasoning,
      input: resolveModelInput(
        savedModel.provider,
        savedModel.modelID,
        savedModel.input ?? ['text'],
      ),
      availableThinkingLevels,
      contextWindow: savedModel.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: savedModel.maxTokens ?? DEFAULT_MAX_TOKENS,
      builtin: false,
    })
  }

  return merged
}

/** Overlay provider-level custom catalogs on top of pi-ai's built-in catalog. */
export function mergeConfiguredProvidersIntoCatalog(
  catalog: ModelCatalogProvider[],
  providers: readonly ProviderConfig[],
): ModelCatalogProvider[] {
  const merged = catalog.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => ({ ...model })),
  }))

  for (const configured of providers) {
    let provider = merged.find((item) => item.id === configured.id)
    if (!provider) {
      provider = {
        id: configured.id,
        name: configured.name ?? configured.id,
        builtin: false,
        models: [],
      }
      merged.push(provider)
    }

    for (const model of configured.models ?? []) {
      if (provider.models.some((item) => item.id === model.id)) continue
      provider.models.push(toCatalogModel(configured.id, model))
    }
  }

  return merged
}

/**
 * Expand configured providers into the model profiles consumed by the chat
 * runtime. Built-in providers contribute every pi-ai model automatically.
 */
export function getConfiguredModelConfigs(
  providers: readonly ProviderConfig[],
  catalog: readonly ModelCatalogProvider[],
): SavedModelConfig[] {
  const models: SavedModelConfig[] = []
  const providerById = new Map(catalog.map((provider) => [provider.id, provider]))

  for (const configured of providers) {
    const provider = providerById.get(configured.id)
    if (!provider) continue

    for (const model of provider.models) {
      const isCustomModel = model.builtin === false
      models.push({
        id: `${configured.id}:${model.id}`,
        provider: configured.id,
        modelID: model.id,
        thinkingLevel: getDefaultThinkingLevel(model.availableThinkingLevels, model.reasoning),
        ...(configured.baseUrl ? { baseUrl: configured.baseUrl } : {}),
        ...(configured.name ? { providerName: configured.name } : {}),
        ...((model.api ?? configured.api) ? { api: model.api ?? configured.api } : {}),
        ...(isCustomModel
          ? {
              modelName: model.name,
              reasoning: model.reasoning,
              input: [...model.input],
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
            }
          : {}),
      })
    }
  }

  return models
}

export function getAgentModelChoices(config: AgentConfig) {
  const providers = getConfiguredProviders(config)
  const catalog = mergeSavedModelsIntoCatalog(mergeConfiguredProvidersIntoCatalog(getModelCatalog(), providers), getSavedModels(config))
  const expandedModels = getConfiguredModelConfigs(providers, catalog)

  return {
    providers,
    catalog,
    models: expandedModels.length ? expandedModels : getSavedModels(config),
  }
}

export function updateAgentModelSelectionFromCatalog(
  config: AgentConfig,
  selection: AgentModelSelection,
): AgentConfig {
  const { models } = getAgentModelChoices(config)
  return updateAgentModelSelection({ ...config, models }, selection)
}

function toCatalogModel(
  providerID: string,
  model: ProviderModelConfig,
): ModelCatalogProvider['models'][number] {
  const reasoning = model.reasoning ?? findBuiltinModel(providerID, model.id)?.reasoning ?? false
  return {
    id: model.id,
    name: model.name ?? model.id,
    ...(model.api ? { api: model.api } : {}),
    reasoning,
    input: resolveModelInput(providerID, model.id, model.input ?? ['text']),
    availableThinkingLevels: getModelThinkingLevels(providerID, model.id, reasoning),
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
    builtin: false,
  }
}

export const modelCatalogDefaults = {
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  maxTokens: DEFAULT_MAX_TOKENS,
} as const

function getDefaultThinkingLevel(
  availableThinkingLevels: readonly ThinkingLevel[],
  reasoning: boolean,
): ThinkingLevel {
  if (!reasoning || availableThinkingLevels.length === 0) return 'off'

  const preferredIndex = UI_THINKING_LEVELS.indexOf('medium')
  return (
    availableThinkingLevels.find((level) => UI_THINKING_LEVELS.indexOf(level) >= preferredIndex) ??
    availableThinkingLevels[availableThinkingLevels.length - 1] ??
    'off'
  )
}
