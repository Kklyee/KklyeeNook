import type { AgentConfig } from '@/shared/agent/agentConfig'

const DEFAULT_CONFIG: AgentConfig = {
  model: { provider: 'anthropic', modelID: '...', thinkingLevel: 'medium' },

  tools: { enabled: ['read', 'bash', 'edit', 'write'] },
}

export class AgentConfigStore {
  private config: AgentConfig

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,

      model: { ...DEFAULT_CONFIG.model, ...config?.model },

      tools: { ...DEFAULT_CONFIG.tools, ...config?.tools },
    }
  }

  get(): AgentConfig {
    return this.config
  }

  set(config: AgentConfig) {
    this.config = config
  }
}
