import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { ModelCatalogProvider } from '@/shared/agent/agentSettings'
import type { ThinkingLevel } from '@/shared/agent/agentConfig'
import { resolveModelInput } from '@/shared/agent/modelCapabilities'

const builtins = builtinModels()
const UI_THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high']

const isUiThinkingLevel = (level: string): level is ThinkingLevel =>
  UI_THINKING_LEVELS.some((candidate) => candidate === level)

export function getModelCatalog(): ModelCatalogProvider[] {
  return builtins
    .getProviders()
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: builtins
        .getModels(provider.id)
        .map((model) => ({
          id: model.id,
          name: model.name,
          reasoning: model.reasoning,
          input: resolveModelInput(provider.id, model.id, model.input),
          availableThinkingLevels: getSupportedThinkingLevels(model).filter(isUiThinkingLevel),
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        })),
    }))
    .filter((provider) => provider.models.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function hasBuiltinModel(provider: string, modelID: string): boolean {
  return builtins.getModel(provider, modelID) !== undefined
}
