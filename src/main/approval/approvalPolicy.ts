import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'

import type {
  PermissionDescriptor,
  PermissionGrant,
  PermissionGrantDuration,
} from '@/shared/approval/approvalTypes'
import type { PermissionGrantRepo } from '../db/repositories/permissionGrantRepo'

const protectedTools = new Set(['read', 'write', 'edit', 'bash'])
const deletionCommand =
  /(?:^|[;&|]\s*)(?:rm\b|rmdir\b|del\b|erase\b|remove-item\b)|\bgit\s+clean\b/i

export type ApprovalPolicyDecision =
  | { outcome: 'allow'; permission?: PermissionDescriptor; grant?: PermissionGrant }
  | { outcome: 'prompt'; permission: PermissionDescriptor }

export class ApprovalPolicy {
  constructor(
    private readonly repo: PermissionGrantRepo,
    private readonly workspace: string | (() => string),
  ) {}

  protects(toolName: string): boolean {
    return protectedTools.has(toolName)
  }

  async evaluate(
    sessionId: string,
    toolName: string,
    args: unknown,
  ): Promise<ApprovalPolicyDecision> {
    if (!this.protects(toolName)) return { outcome: 'allow' }

    const permission = this.describe(toolName, args)
    const grant = (await this.repo.list()).find(
      (candidate) =>
        (candidate.duration === 'always' || candidate.sessionId === sessionId) &&
        matches(candidate.permission, permission),
    )

    return grant ? { outcome: 'allow', permission, grant } : { outcome: 'prompt', permission }
  }

  async grant(
    duration: PermissionGrantDuration,
    sessionId: string,
    permission: PermissionDescriptor,
  ): Promise<PermissionGrant> {
    const grants = await this.repo.list()
    const existing = grants.find(
      (candidate) =>
        candidate.duration === duration &&
        candidate.sessionId === (duration === 'session' ? sessionId : undefined) &&
        samePermission(candidate.permission, permission),
    )
    if (existing) return existing

    const grant: PermissionGrant = {
      id: randomUUID(),
      effect: 'allow',
      duration,
      sessionId: duration === 'session' ? sessionId : undefined,
      permission,
      createdAt: Date.now(),
    }
    await this.repo.save(grant)
    return grant
  }

  async listGrants(): Promise<PermissionGrant[]> {
    return this.repo.list()
  }

  async revoke(id: string): Promise<void> {
    await this.repo.delete(id)
  }

  private describe(toolName: string, args: unknown): PermissionDescriptor {
    const input = isRecord(args) ? args : {}
    const cwd = typeof this.workspace === 'string' ? this.workspace : this.workspace()

    if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
      const suppliedPath = typeof input.path === 'string' ? input.path : ''
      const absolutePath = resolve(cwd, suppliedPath)
      const insideProject = isWithin(cwd, absolutePath)
      const isRead = toolName === 'read'

      return {
        toolName,
        action: isRead ? 'filesystem.read' : 'filesystem.write',
        resourceKind: 'path',
        resource: isRead && insideProject ? resolve(cwd) : absolutePath,
        recursive: isRead && insideProject,
        description:
          isRead && insideProject
            ? `读取项目目录 ${resolve(cwd)}`
            : `${isRead ? '读取' : '修改'}文件 ${absolutePath}`,
      }
    }

    if (toolName === 'bash') {
      const command = typeof input.command === 'string' ? input.command.trim() : ''
      const deletesFiles = deletionCommand.test(command)
      return {
        toolName,
        action: deletesFiles ? 'shell.delete' : 'shell.execute',
        resourceKind: 'command',
        resource: command,
        recursive: false,
        description: `${deletesFiles ? '执行删除命令' : '执行命令'} ${command}`,
      }
    }

    return {
      toolName,
      action: `tool.${toolName}`,
      resourceKind: 'tool',
      resource: toolName,
      recursive: false,
      description: `使用工具 ${toolName}`,
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function samePermission(left: PermissionDescriptor, right: PermissionDescriptor): boolean {
  return (
    left.toolName === right.toolName &&
    left.action === right.action &&
    left.resourceKind === right.resourceKind &&
    left.resource === right.resource &&
    left.recursive === right.recursive
  )
}

function matches(granted: PermissionDescriptor, requested: PermissionDescriptor): boolean {
  if (
    granted.toolName !== requested.toolName ||
    granted.action !== requested.action ||
    granted.resourceKind !== requested.resourceKind
  ) {
    return false
  }

  if (!granted.recursive || granted.resourceKind !== 'path') {
    return granted.resource === requested.resource
  }

  return isWithin(granted.resource, requested.resource)
}
