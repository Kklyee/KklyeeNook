import { expect, test } from 'vitest'

import {
  getConfiguredModelConfigs,
  getModelCatalog,
  hasBuiltinModel,
  mergeConfiguredProvidersIntoCatalog,
  mergeSavedModelsIntoCatalog,
} from './modelCatalog'

test('exposes the pi-ai built-in provider and model catalog', () => {
  const catalog = getModelCatalog()
  const deepseek = catalog.find((provider) => provider.id === 'deepseek')
  const deepseekFlash = deepseek?.models.find((model) => model.id === 'deepseek-v4-flash')

  expect(deepseek?.name).toBe('DeepSeek')
  expect(deepseekFlash?.input).toEqual(['text', 'image'])
  expect(deepseekFlash?.availableThinkingLevels).toEqual(['off', 'low', 'high', 'max'])
  expect(hasBuiltinModel('deepseek', 'missing-model')).toBe(false)
})

test('keeps a saved model that pi-ai does not know in the editable catalog', () => {
  const catalog = mergeSavedModelsIntoCatalog(getModelCatalog(), [
    {
      id: 'deepseek:deepseek-v4.1-flash',
      provider: 'deepseek',
      modelID: 'deepseek-v4.1-flash',
      providerName: 'DeepSeek',
      modelName: 'DeepSeek V4.1 Flash',
      baseUrl: 'https://api.deepseek.com/v1',
      api: 'openai-completions',
      reasoning: true,
      input: ['text'],
      contextWindow: 1_000_000,
      maxTokens: 16_384,
      thinkingLevel: 'medium',
    },
  ])

  const model = catalog
    .find((provider) => provider.id === 'deepseek')
    ?.models.find((item) => item.id === 'deepseek-v4.1-flash')
  expect(model).toMatchObject({
    name: 'DeepSeek V4.1 Flash',
    builtin: false,
    contextWindow: 1_000_000,
  })
})

test('expands configured providers into every built-in model for chat selection', () => {
  const providers = [{ id: 'deepseek' }]
  const catalog = mergeConfiguredProvidersIntoCatalog(getModelCatalog(), providers)
  const models = getConfiguredModelConfigs(providers, catalog)

  expect(models.some((model) => model.id === 'deepseek:deepseek-v4-flash')).toBe(true)
  const deepseekFlash = models.find((model) => model.id === 'deepseek:deepseek-v4-flash')
  const catalogFlash = catalog
    .find((provider) => provider.id === 'deepseek')
    ?.models.find((model) => model.id === 'deepseek-v4-flash')
  expect(deepseekFlash?.thinkingLevel).toBe(catalogFlash?.reasoning ? 'high' : 'off')
})

test('keeps a provider-level custom model in the same chat catalog', () => {
  const providers = [
    {
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: [
        {
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          reasoning: true,
          input: ['text' as const],
        },
      ],
    },
  ]
  const catalog = mergeConfiguredProvidersIntoCatalog(getModelCatalog(), providers)
  const models = getConfiguredModelConfigs(providers, catalog)

  expect(models.find((model) => model.modelID === 'deepseek-v4.1-flash')).toMatchObject({
    baseUrl: 'https://api.deepseek.com/v1',
    modelName: 'DeepSeek V4.1 Flash',
    reasoning: true,
    thinkingLevel: 'medium',
  })
})
