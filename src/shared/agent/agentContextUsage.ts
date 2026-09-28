export interface AgentContextUsage {
  tokens?: number
  contextWindow?: number
  percent?: number
}

export function toAgentContextUsage(
  value:
    | {
        tokens: number | null
        contextWindow: number
        percent: number | null
      }
    | undefined,
): AgentContextUsage | undefined {
  if (!value) return undefined

  const usage: AgentContextUsage = {}
  if (typeof value.tokens === 'number') usage.tokens = value.tokens
  if (typeof value.contextWindow === 'number') usage.contextWindow = value.contextWindow
  if (typeof value.percent === 'number') usage.percent = value.percent
  return Object.keys(usage).length ? usage : undefined
}
