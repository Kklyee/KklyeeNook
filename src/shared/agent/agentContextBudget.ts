import type { AgentCompactionSettings } from './agentConfig'
import type { AgentContextUsage } from './agentContextUsage'

export type AgentContextBudgetState = 'unknown' | 'normal' | 'warning' | 'critical' | 'compacting'

export interface AgentContextBudget {
  tokens?: number
  contextWindow?: number
  reserveTokens: number
  keepRecentTokens: number
  usableTokens?: number
  remainingTokens?: number
  remainingBeforeCompaction?: number
  usedPercent?: number
  usablePercent?: number
  state: AgentContextBudgetState
}

export function calculateAgentContextBudget(
  usage: AgentContextUsage | undefined,
  compaction: AgentCompactionSettings,
  options?: { compacting?: boolean },
): AgentContextBudget {
  const tokens = nonNegativeFinite(usage?.tokens)
  const contextWindow = nonNegativeFinite(usage?.contextWindow)
  const reserveTokens = nonNegativeFinite(compaction.reserveTokens) ?? 0
  const budget: AgentContextBudget = {
    tokens,
    contextWindow,
    reserveTokens,
    keepRecentTokens: nonNegativeFinite(compaction.keepRecentTokens) ?? 0,
    state: 'unknown',
  }

  if (contextWindow !== undefined) {
    const usableTokens = Math.max(0, contextWindow - reserveTokens)
    budget.usableTokens = usableTokens
    if (tokens !== undefined) {
      budget.remainingTokens = Math.max(0, contextWindow - tokens)
      budget.remainingBeforeCompaction = Math.max(0, usableTokens - tokens)
      budget.usedPercent = finiteRatio(tokens, contextWindow)
      budget.usablePercent = finiteRatio(tokens, usableTokens)
      if (budget.usablePercent !== undefined) {
        budget.state =
          budget.usablePercent >= 0.9
            ? 'critical'
            : budget.usablePercent >= 0.7
              ? 'warning'
              : 'normal'
      }
    }
  }
  if (options?.compacting) budget.state = 'compacting'
  return budget
}

function nonNegativeFinite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined
}

function finiteRatio(tokens: number, total: number): number | undefined {
  const ratio = total > 0 ? tokens / total : undefined
  return ratio !== undefined && Number.isFinite(ratio) ? ratio : undefined
}

export function getAgentCompactionSettingsErrors(
  compaction: AgentCompactionSettings,
  contextWindow?: number,
): Partial<Record<'reserveTokens' | 'keepRecentTokens', string>> {
  const errors: Partial<Record<'reserveTokens' | 'keepRecentTokens', string>> = {}
  for (const key of ['reserveTokens', 'keepRecentTokens'] as const) {
    const label = key === 'reserveTokens' ? '预留 Token' : '保留最近 Token'
    const value = compaction[key]
    if (!Number.isInteger(value) || value < 0) {
      errors[key] = `${label}必须是非负整数。`
    } else if (
      contextWindow !== undefined &&
      Number.isFinite(contextWindow) &&
      contextWindow > 0 &&
      value >= contextWindow
    ) {
      errors[key] =
        `${label}必须小于当前模型的上下文窗口（${contextWindow.toLocaleString('en-US')}）。`
    }
  }
  return errors
}
