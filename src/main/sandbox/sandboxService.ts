import type { PermissionRequest, PermissionResource } from '@/shared/approval/permission'
import { PermissionPolicy } from '../approval/permissionPolicy'
import {
  DirectExecutionBackend,
  platformSandboxBackend,
  type SandboxBackend,
  type SandboxExecutionRequest,
  type SandboxExecutionResult,
} from './sandboxBackend'
import { SandboxPolicy } from './sandboxPolicy'
import { WorkspacePathPolicy } from './workspacePathPolicy'

export class SandboxService {
  readonly paths = new WorkspacePathPolicy()
  readonly policy: PermissionPolicy
  private readonly elevations = new Map<
    string,
    { request: string; mode: PermissionRequest['mode'] }
  >()
  constructor(private readonly backend: SandboxBackend = platformSandboxBackend()) {
    this.policy = new PermissionPolicy(new SandboxPolicy(this.paths, backend))
  }
  elevate(toolCallId: string, request: PermissionRequest, mode: PermissionRequest['mode']): void {
    this.elevations.set(toolCallId, { request: JSON.stringify(request), mode })
  }
  async authorize(request: PermissionRequest, toolCallId?: string): Promise<PermissionRequest> {
    const elevation = toolCallId ? this.elevations.get(toolCallId) : undefined
    if (elevation?.request === JSON.stringify(request)) {
      this.elevations.delete(toolCallId!)
      const elevated = { ...request, mode: elevation.mode }
      const decision = await this.policy.evaluate(elevated)
      if (decision.outcome !== 'allow') throw new Error(decision.reason)
      return elevated
    }
    const decision = await this.policy.evaluate(request)
    if (decision.outcome !== 'allow') throw new Error(decision.reason)
    return request
  }
  async resolveFile(request: PermissionRequest, toolCallId?: string): Promise<string> {
    const authorized = await this.authorize(request, toolCallId)
    if (request.resource.kind !== 'path') throw new Error('Expected path resource')
    const target = await this.paths.resolve(request.resource.path, request.workspace?.rootPath)
    if (authorized.mode !== 'full-access' && !target.inside) throw new Error('目标在工作区外')
    return target.path
  }
  async execute(
    request: PermissionRequest,
    execution: Omit<SandboxExecutionRequest, 'mode'>,
    toolCallId?: string,
  ): Promise<SandboxExecutionResult> {
    const authorized = await this.authorize(request, toolCallId)
    return authorized.mode === 'full-access'
      ? new DirectExecutionBackend().execute({ ...execution, mode: authorized.mode })
      : this.backend.execute({ ...execution, mode: authorized.mode })
  }
}

export function toolPermissionResource(toolName: string, args: unknown): PermissionResource {
  const input = args as Record<string, unknown>
  if (['read', 'write', 'edit'].includes(toolName)) {
    if (typeof input?.path !== 'string') throw new Error('File path is required')
    return { kind: 'path', path: input.path, action: toolName as 'read' | 'write' | 'edit' }
  }
  if (toolName === 'bash') {
    if (typeof input?.command !== 'string') throw new Error('Command is required')
    return {
      kind: 'command',
      command: input.command,
      ...(typeof input.cwd === 'string' ? { cwd: input.cwd } : {}),
    }
  }
  return { kind: 'tool', name: toolName }
}
