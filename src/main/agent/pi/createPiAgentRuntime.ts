import type { AgentRuntimeFactory } from '../agentRuntime'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import type { ApprovalService } from '@/main/approval/approvalService'
import type { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { PiAgentRuntime } from './piAgentRuntime'
import { AgentRuntimeStateRepo } from '@/main/db/repo/agentRuntimeStateRepo'

export function createPiAgentRuntimeFactory(
  configStore: AgentConfigStore,
  credentialStore: CredentialStore,
  approvalService: ApprovalService,
  approvalPolicy: ApprovalPolicy,
  runtimeStateRepo: AgentRuntimeStateRepo,
  sessionDir: string,
): AgentRuntimeFactory {
  return {
    create(sessionId) {
      return new PiAgentRuntime(
        sessionId,
        configStore,
        credentialStore,
        { approvalService, approvalPolicy },
        runtimeStateRepo,
        sessionDir,
      )
    },
  }
}
