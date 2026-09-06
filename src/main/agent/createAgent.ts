import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import { CredentialStore } from '@/main/settings/credentialStore'

import { PIAgentAdapter } from './PIAgentAdapter'
import { AgentConfig } from '@/shared/agent/agentConfig'

export async function createAgent(
  config: AgentConfig,
  credentialStore: CredentialStore,
): Promise<PIAgentAdapter> {
  const configStore = new AgentConfigStore(config)
  const agent = new PIAgentAdapter(configStore, credentialStore)
  return agent
}
