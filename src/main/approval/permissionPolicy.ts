import type { PermissionDecision, PermissionRequest } from '@/shared/approval/permission'
import type { SandboxPolicy } from '../sandbox/sandboxPolicy'

export class PermissionPolicy {
  constructor(private readonly sandbox: SandboxPolicy) {}
  async evaluate(request: PermissionRequest): Promise<PermissionDecision> {
    if (
      request.resource.kind === 'tool' &&
      request.toolName.startsWith('mcp__') &&
      request.mode !== 'full-access'
    )
      return {
        outcome: 'ask',
        requestedMode: 'full-access',
        reason: 'MCP 工具可能产生外部副作用，仅允许本次执行：' + request.toolName,
      }
    return this.sandbox.evaluate(request)
  }
}
