import { expect, test } from 'vitest'
import { DEFAULT_AGENT_COMPACTION_SETTINGS } from './agentConfig'
import { calculateAgentContextBudget, getAgentCompactionSettingsErrors } from './agentContextBudget'
import { formatContextTokens } from './contextTokens'

const compaction = { ...DEFAULT_AGENT_COMPACTION_SETTINGS, reserveTokens: 16_000 }

test('derives the budget from runtime usage and reserve tokens', () => {
  const budget = calculateAgentContextBudget(
    { tokens: 82_000, contextWindow: 128_000, percent: 1 },
    compaction,
  )
  expect(budget).toMatchObject({
    tokens: 82_000,
    contextWindow: 128_000,
    reserveTokens: 16_000,
    keepRecentTokens: 20_000,
    usableTokens: 112_000,
    remainingTokens: 46_000,
    remainingBeforeCompaction: 30_000,
    state: 'warning',
  })
  expect(budget.usedPercent).toBeCloseTo(82_000 / 128_000)
  expect(budget.usablePercent).toBeCloseTo(82_000 / 112_000)
})

test.each([
  [69_999, 'normal'],
  [70_000, 'warning'],
  [89_999, 'warning'],
  [90_000, 'critical'],
] as const)('uses the usable budget boundary at %i tokens', (tokens, state) => {
  expect(calculateAgentContextBudget({ tokens, contextWindow: 116_000 }, compaction).state).toBe(
    state,
  )
})

test.each([
  undefined,
  {},
  { tokens: 1_000 },
  { contextWindow: 128_000 },
  { tokens: 1_000, contextWindow: 0 },
  { tokens: 1_000, contextWindow: -1 },
  { tokens: NaN, contextWindow: 128_000 },
  { tokens: Infinity, contextWindow: 128_000 },
  { tokens: 1_000, contextWindow: Infinity },
])('keeps unavailable budgets unknown without non-finite values: %j', (usage) => {
  const budget = calculateAgentContextBudget(usage, compaction)
  expect(budget.state).toBe('unknown')
  for (const value of Object.values(budget)) {
    if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
  }
})

test('clamps negative values and exhausted remaining budgets', () => {
  expect(
    calculateAgentContextBudget(
      { tokens: -10, contextWindow: 128_000 },
      { ...compaction, reserveTokens: -5, keepRecentTokens: -1 },
    ),
  ).toMatchObject({ tokens: 0, reserveTokens: 0, keepRecentTokens: 0, state: 'normal' })
  expect(
    calculateAgentContextBudget({ tokens: 150_000, contextWindow: 128_000 }, compaction),
  ).toMatchObject({ remainingTokens: 0, remainingBeforeCompaction: 0, state: 'critical' })
  expect(
    calculateAgentContextBudget(
      { tokens: 1_000, contextWindow: 128_000 },
      { ...compaction, reserveTokens: 200_000 },
    ),
  ).toMatchObject({
    usableTokens: 0,
    remainingBeforeCompaction: 0,
    usablePercent: undefined,
    state: 'unknown',
  })
})

test('compacting overrides unknown and critical states', () => {
  expect(calculateAgentContextBudget(undefined, compaction, { compacting: true }).state).toBe(
    'compacting',
  )
  expect(
    calculateAgentContextBudget({ tokens: 128_000, contextWindow: 128_000 }, compaction, {
      compacting: true,
    }).state,
  ).toBe('compacting')
})

test('avoids overflowing ratios and invalid compaction numbers', () => {
  const budget = calculateAgentContextBudget(
    { tokens: Number.MAX_VALUE, contextWindow: Number.MIN_VALUE },
    { ...compaction, reserveTokens: NaN, keepRecentTokens: Infinity },
  )
  for (const value of Object.values(budget)) {
    if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
  }
})

test.each([-1, 1.5, NaN, Infinity, 128_000, 200_000])(
  'rejects invalid compaction setting %s for a known model',
  (value) => {
    const errors = getAgentCompactionSettingsErrors(
      { ...compaction, reserveTokens: value, keepRecentTokens: value },
      128_000,
    )
    expect(errors.reserveTokens).toBeDefined()
    expect(errors.keepRecentTokens).toBeDefined()
  },
)

test('allows non-negative integers and does not invent an unknown model limit', () => {
  expect(
    getAgentCompactionSettingsErrors(
      { ...compaction, reserveTokens: 0, keepRecentTokens: 127_999 },
      128_000,
    ),
  ).toEqual({})
  expect(
    getAgentCompactionSettingsErrors({ ...compaction, reserveTokens: 200_000 }, undefined),
  ).toEqual({})
})

test.each([
  [1_024, '1K'],
  [16_384, '16K'],
  [128_000, '128K'],
  [1_000_000, '1M'],
  [0, '0'],
  [999, '999'],
] as const)('formats %i context tokens as %s', (tokens, formatted) => {
  expect(formatContextTokens(tokens)).toBe(formatted)
})
