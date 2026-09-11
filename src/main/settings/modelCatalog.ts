import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { ModelCatalogProvider } from '@/shared/agent/agentSettings'

const builtins = builtinModels()

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
