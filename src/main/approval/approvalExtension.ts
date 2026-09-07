import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

import type { ApprovalService } from './approvalService'
import type { ApprovalPolicy } from './approvalPolicy'

export function createApprovalExtension(
  approvalService: ApprovalService,
  approvalPolicy: ApprovalPolicy,
): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', async (event) => {
      const requiresApproval = approvalPolicy.requiresApproval(event.toolName, event.input)
      if (!requiresApproval) {
        return undefined
      }

      const approved = await approvalService.request({
        id: event.toolCallId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.input,
      })

      if (approved) {
        return undefined
      }

      return { block: true, reason: 'User denied tool execution' }
    })
  }
}
