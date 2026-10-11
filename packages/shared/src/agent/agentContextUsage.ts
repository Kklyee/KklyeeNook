export interface AgentContextUsage {
  tokens?: number
  contextWindow?: number
  percent?: number
}

export function toAgentContextUsage(
  value: { tokens: number | null; contextWindow: number; percent: number | null } | undefined,
): AgentContextUsage | undefined {
  if (!value) return undefined

  const usage: AgentContextUsage = {}
  if (typeof value.tokens === 'number' && Number.isFinite(value.tokens))
    usage.tokens = Math.max(0, value.tokens)
  if (typeof value.contextWindow === 'number' && Number.isFinite(value.contextWindow))
    usage.contextWindow = Math.max(0, value.contextWindow)
  if (typeof value.percent === 'number' && Number.isFinite(value.percent))
    usage.percent = Math.max(0, value.percent)
  return Object.keys(usage).length ? usage : undefined
}
