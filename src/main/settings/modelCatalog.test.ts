import { expect, test } from 'vitest'

import { getModelCatalog, hasBuiltinModel } from './modelCatalog'

test('exposes the pi-ai built-in provider and model catalog', () => {
  const catalog = getModelCatalog()
  const deepseek = catalog.find((provider) => provider.id === 'deepseek')
  const deepseekFlash = deepseek?.models.find((model) => model.id === 'deepseek-v4-flash')

  expect(deepseek?.name).toBe('DeepSeek')
  expect(deepseekFlash?.input).toEqual(['text', 'image'])
  expect(deepseekFlash?.availableThinkingLevels).toEqual(['off', 'low', 'high'])
  expect(hasBuiltinModel('deepseek', 'missing-model')).toBe(false)
})
