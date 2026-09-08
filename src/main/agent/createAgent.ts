import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import { CredentialStore } from '@/main/settings/credentialStore'

import { PIAgentAdapter } from './PIAgentAdapter'
import { AgentConfig } from '@/shared/agent/agentConfig'
import { ApprovalService } from '@/main/approval/approvalService'
import { ApprovalPolicy } from '../approval/approvalPolicy'

export async function createAgent(
  config: AgentConfig,
  credentialStore: CredentialStore,
  {
    approvalService,
    approvalPolicy,
  }: { approvalService: ApprovalService; approvalPolicy: ApprovalPolicy },
): Promise<PIAgentAdapter> {
  const configStore = new AgentConfigStore(config)
  const agent = new PIAgentAdapter(configStore, credentialStore, {
    approvalService,
    approvalPolicy,
  })
  return agent
}
