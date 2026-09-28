import { expect, test } from 'vitest'

import { updateAgentModelSelection } from './agentConfig'

test('updates the active model and its thinking level', () => {
  const config = {
    model: { provider: 'test', modelID: 'first', thinkingLevel: 'off' as const },
    models: [
      { id: 'test:first', provider: 'test', modelID: 'first', thinkingLevel: 'off' as const },
      { id: 'test:second', provider: 'test', modelID: 'second', thinkingLevel: 'low' as const },
    ],
    activeModelId: 'test:first',
    tools: { enabled: [] },
  }

  const updated = updateAgentModelSelection(config, {
    provider: 'test',
    modelID: 'second',
    thinkingLevel: 'high',
  })

  expect(updated.activeModelId).toBe('test:second')
  expect(updated.model).toMatchObject({
    provider: 'test',
    modelID: 'second',
    thinkingLevel: 'high',
  })
  expect(updated.models?.find((model) => model.id === 'test:second')?.thinkingLevel).toBe('high')
})

test('rejects a model that is not configured', () => {
  expect(() =>
    updateAgentModelSelection(
      {
        model: { provider: 'test', modelID: 'first' },
        tools: { enabled: [] },
      },
      { provider: 'test', modelID: 'missing', thinkingLevel: 'medium' },
    ),
  ).toThrow('模型尚未配置: test/missing')
})
