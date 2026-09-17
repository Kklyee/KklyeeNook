import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { ModelCatalogProvider } from '@/shared/agent/agentSettings'
import type {
  ProviderConfig,
  ProviderModelConfig,
  SavedModelConfig,
  ThinkingLevel,
} from '@/shared/agent/agentConfig'
import { resolveModelInput } from '@/shared/agent/modelCapabilities'

const builtins = builtinModels()
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

    const reasoning = savedModel.reasoning ?? savedModel.thinkingLevel !== 'off'
    const availableThinkingLevels: ThinkingLevel[] = reasoning ? [...UI_THINKING_LEVELS] : ['off']
    if (savedModel.thinkingLevel && !availableThinkingLevels.includes(savedModel.thinkingLevel)) {
      availableThinkingLevels.push(savedModel.thinkingLevel)
    }

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

  for (const configured of providers) {
    const provider = catalog.find((item) => item.id === configured.id)
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

function toCatalogModel(
  providerID: string,
  model: ProviderModelConfig,
): ModelCatalogProvider['models'][number] {
  const reasoning = model.reasoning ?? false
  return {
    id: model.id,
    name: model.name ?? model.id,
    ...(model.api ? { api: model.api } : {}),
    reasoning,
    input: resolveModelInput(providerID, model.id, model.input ?? ['text']),
    availableThinkingLevels: reasoning ? [...UI_THINKING_LEVELS] : ['off'],
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
