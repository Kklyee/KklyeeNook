import { expect, test } from 'vitest'

import { getModelCatalog, hasBuiltinModel } from './modelCatalog'

test('exposes the pi-ai built-in provider and model catalog', () => {
  const catalog = getModelCatalog()
  const deepseek = catalog.find((provider) => provider.id === 'deepseek')

  expect(deepseek?.name).toBe('DeepSeek')
  expect(deepseek?.models.some((model) => model.id === 'deepseek-v4-flash')).toBe(true)
  expect(hasBuiltinModel('deepseek', 'missing-model')).toBe(false)
})
