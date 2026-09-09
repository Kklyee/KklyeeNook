import type { AgentRuntimeFactory } from '../agentRuntime'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import type { ApprovalService } from '@/main/approval/approvalService'
import type { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { PiAgentRuntime } from './piAgentRuntime'

export function createPiAgentRuntimeFactory(
  configStore: AgentConfigStore,
  credentialStore: CredentialStore,
  approvalService: ApprovalService,
  approvalPolicy: ApprovalPolicy,
): AgentRuntimeFactory {
  return {
    create() {
      return new PiAgentRuntime(configStore, credentialStore, {
        approvalService,
        approvalPolicy,
      })
    },
  }
}
