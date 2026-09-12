import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

import type { ApprovalPolicy } from './approvalPolicy'
import type { AgentEvent } from '@/shared/agent/agentEvent'

const APPROVAL_OPTIONS = [
  'Allow once',
  'Allow this tool for this session',
  'Always allow this tool',
  'Deny',
] as const

export function createPiApprovalExtension(
  sessionId: string,
  approvalPolicy: ApprovalPolicy,
  emit: (event: AgentEvent) => void,
): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', async (event, context) => {
      const policyDecision = await approvalPolicy.evaluate(sessionId, event.toolName, event.input)
      if (policyDecision.outcome === 'allow') {
        return undefined
      }

      emit({
        type: 'approval_required',
        approvalId: event.toolCallId,
        call: { id: event.toolCallId, toolName: event.toolName, args: event.input },
      })

      const selected = await context.ui.select(`${event.toolName} requests permission`, [
        ...APPROVAL_OPTIONS,
      ])
      const decision =
        selected === 'Allow once'
          ? 'allow_once'
          : selected === 'Allow this tool for this session'
            ? 'allow_session'
            : selected === 'Always allow this tool'
              ? 'allow_always'
              : 'deny'

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
