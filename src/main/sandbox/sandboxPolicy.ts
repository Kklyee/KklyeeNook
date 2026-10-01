import type { PermissionDecision, PermissionRequest } from '@/shared/approval/permission'
import type { SandboxBackend } from './sandboxBackend'
import { WorkspacePathPolicy } from './workspacePathPolicy'

export class SandboxPolicy {
  constructor(
    readonly paths: WorkspacePathPolicy,
    private readonly backend: SandboxBackend,
  ) {}
  async evaluate(request: PermissionRequest): Promise<PermissionDecision> {
    const { mode, resource, workspace } = request
    if (resource.kind === 'path') {
      const target = await this.paths.resolve(resource.path, workspace?.rootPath)
      if (mode === 'full-access') return { outcome: 'allow' }
      if (!workspace) return { outcome: 'deny', reason: '需要关联一个可用项目，或显式选择完全权限' }
      if (resource.action !== 'read' && mode === 'read-only')
        return {
          outcome: 'ask',
          requestedMode: target.inside ? 'workspace-write' : 'full-access',
          reason: target.inside
            ? '当前会话为只读模式，创建或修改此工作区文件需要本次提升为工作区写入权限：' +
              target.path
            : '此文件在工作区外，需要允许本次使用完全权限：' + target.path,
        }
      if (target.inside) return { outcome: 'allow' }
      return mode === 'workspace-write'
        ? {
            outcome: 'ask',
            requestedMode: 'full-access',
            reason: '目标在工作区外，需要允许本次使用完全权限：' + target.path,
          }
        : { outcome: 'deny', reason: '目标在工作区外' }
    }
    if (resource.kind === 'command') {
      if (!workspace && !resource.cwd)
        return { outcome: 'deny', reason: '未关联项目时执行命令必须指定绝对 cwd' }
      if (resource.cwd) {
        const target = await this.paths.resolve(resource.cwd, workspace?.rootPath)
        if (mode !== 'full-access' && !target.inside)
          return {
            outcome: 'ask',
            requestedMode: 'full-access',
            reason: '命令目录在工作区外，需要允许本次使用完全权限',
          }
      }
      if (mode === 'full-access') return { outcome: 'allow' }
      if (this.backend.support() !== 'full')
        return {
          outcome: 'ask',
          requestedMode: 'full-access',
          reason: '当前平台无法保证该命令只修改工作区。允许本次使用完全权限？\n' + resource.command,
        }
      return { outcome: 'allow' }
    }
    return { outcome: 'allow' }
  }
}
