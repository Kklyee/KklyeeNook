import type { AgentRuntime } from './agentRuntime'
import type { AgentRuntimeFactory } from './agentRuntimeFactory'
import type { AgentConfigStore } from '../settings/agentConfigStore'
import type { CredentialStore } from '../settings/credentialStore'
import type { ApprovalService } from '../approval/approvalService'
import type { ApprovalPolicy } from '../approval/approvalPolicy'
import { PIAgentAdapter } from './piAgentAdapter'

export class PIAgentRuntimeFactory implements AgentRuntimeFactory {
  constructor(
    private readonly configStore: AgentConfigStore,
    private readonly credentialStore: CredentialStore,
    private readonly approvalService: ApprovalService,
    private readonly approvalPolicy: ApprovalPolicy,
  ) {}

  create(_sessionId: string): AgentRuntime {
    return new PIAgentAdapter(this.configStore, this.credentialStore, {
      approvalService: this.approvalService,
      approvalPolicy: this.approvalPolicy,
    })
  }
}
