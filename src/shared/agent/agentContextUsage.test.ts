import { expect, test } from 'vitest'
import { toAgentContextUsage } from './agentContextUsage'

test('keeps unavailable context usage fields undefined', () => {
  expect(toAgentContextUsage({ tokens: null, contextWindow: 128_000, percent: null })).toEqual({
    contextWindow: 128_000,
  })
  expect(toAgentContextUsage(undefined)).toBeUndefined()
})

test('discards non-finite runtime fields and clamps negatives', () => {
  expect(
    toAgentContextUsage({ tokens: NaN, contextWindow: Infinity, percent: NaN }),
  ).toBeUndefined()
  expect(toAgentContextUsage({ tokens: -1, contextWindow: -1, percent: -1 })).toEqual({
    tokens: 0,
    contextWindow: 0,
    percent: 0,
  })
})
