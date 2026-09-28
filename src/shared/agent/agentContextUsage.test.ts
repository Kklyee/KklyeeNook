import { expect, test } from 'vitest'
import { toAgentContextUsage } from './agentContextUsage'

test('keeps unavailable context usage fields undefined', () => {
  expect(
    toAgentContextUsage({ tokens: null, contextWindow: 128_000, percent: null }),
  ).toEqual({ contextWindow: 128_000 })
  expect(toAgentContextUsage(undefined)).toBeUndefined()
})
