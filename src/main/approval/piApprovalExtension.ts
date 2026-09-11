import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

import type { ApprovalService } from './approvalService'
import type { ApprovalPolicy } from './approvalPolicy'
import type { AgentEvent } from '@/shared/agent/agentEvent'

export function createPiApprovalExtension(
  sessionId: string,
  approvalService: ApprovalService,
  approvalPolicy: ApprovalPolicy,
  emit: (event: AgentEvent) => void,
): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', async (event) => {
      const policyDecision = await approvalPolicy.evaluate(sessionId, event.toolName, event.input)
      if (policyDecision.outcome === 'allow') {
        return undefined
      }

      emit({
        type: 'approval_required',
        approvalId: event.toolCallId,
        call: { id: event.toolCallId, toolName: event.toolName, args: event.input },
      })

      const decision = await approvalService.request({
        id: event.toolCallId,
        toolCallId: event.toolCallId,
        sessionId,
        toolName: event.toolName,
        args: event.input,
        permission: policyDecision.permission,
      })

      if (decision === 'allow_session' || decision === 'allow_always') {
        await approvalPolicy.grant(
          decision === 'allow_session' ? 'session' : 'always',
          sessionId,
          policyDecision.permission,
        )
      }

      const approved = decision !== 'deny'

      emit({
        type: 'approval_resolved',
        approvalId: event.toolCallId,
        toolCallId: event.toolCallId,
        decision: approved ? 'allow' : 'deny',
      })

      if (approved) {
        return undefined
      }

      return { block: true, reason: 'User denied tool execution' }
    })
  }
}
