import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { PermissionMode } from '@/shared/approval/permission'
import type { AgentExecutionContext } from '@/shared/workspace/workspace'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import { SandboxService, toolPermissionResource } from '../sandbox/sandboxService'

export function createPiApprovalExtension(
  executionContext: AgentExecutionContext & { mode: PermissionMode },
  sandbox: SandboxService,
  emit: (event: AgentEvent) => void,
): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (event) => ({
      systemPrompt:
        (executionContext.workspace
          ? event.systemPrompt
          : event.systemPrompt.replace(/\nCurrent working directory: [^\n]*\n?/g, '\n')) +
        '\nCurrent permission mode: ' +
        executionContext.mode,
    }))
    pi.on('tool_call', async (event, context) => {
      const request = {
        ...executionContext,
        toolName: event.toolName,
        resource: toolPermissionResource(event.toolName, event.input),
      }
      let decision
      try {
        decision = await sandbox.policy.evaluate(request)
      } catch (error) {
        return { block: true, reason: error instanceof Error ? error.message : String(error) }
      }
      if (decision.outcome === 'allow') return undefined
      if (decision.outcome === 'deny') return { block: true, reason: decision.reason }
      emit({
        type: 'approval_required',
        approvalId: event.toolCallId,
        call: { id: event.toolCallId, toolName: event.toolName, args: event.input },
      })
      const selected = await context.ui.select(decision.reason, ['允许本次使用完全权限', '拒绝'])
      const approved = selected === '允许本次使用完全权限'
      if (approved && request.resource.kind !== 'tool') sandbox.elevate(event.toolCallId, request)
      emit({
        type: 'approval_resolved',
        approvalId: event.toolCallId,
        toolCallId: event.toolCallId,
        decision: approved ? 'allow' : 'deny',
      })
      return approved ? undefined : { block: true, reason: '用户拒绝本次执行' }
    })
  }
}
