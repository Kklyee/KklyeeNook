// Only public configuration crosses IPC. API keys stay in the main process.
export interface AgentSettingsSnapshot {
  provider: string
  modelID: string
  thinkingLevel: string
  cwd: string
  hasApiKey: boolean
  tools: Array<{ name: string; requiresApproval: boolean }>
}
