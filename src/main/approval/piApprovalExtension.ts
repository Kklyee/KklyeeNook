import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

import type { ApprovalService } from './approvalService'
import type { ApprovalPolicy } from './approvalPolicy'
import type { AgentEvent } from '@/shared/agent/agentEvent'

export function createPiApprovalExtension(
  approvalService: ApprovalService,
  approvalPolicy: ApprovalPolicy,
  emit: (event: AgentEvent) => void,
): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', async (event) => {
      const requiresApproval = approvalPolicy.requiresApproval(event.toolName, event.input)
      if (!requiresApproval) {
        return undefined
      }

      emit({
        type: 'approval_required',
        approvalId: event.toolCallId,
        toolCallId: event.toolCallId,
        tool: event.toolName,
        args: event.input,
      })

      const approved = await approvalService.request({
        id: event.toolCallId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.input,
      })

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
