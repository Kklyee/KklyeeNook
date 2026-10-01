import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { PermissionMode } from '@/shared/approval/permission'
import type { AgentExecutionContext } from '@/shared/workspace/workspace'

export function createPiApprovalExtension(
  executionContext: AgentExecutionContext & { mode: PermissionMode },
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
  }
}
