import { randomUUID } from 'node:crypto'

import type {
  PermissionDescriptor,
  PermissionGrant,
  PermissionGrantDuration,
} from '@/shared/approval/approvalTypes'
import type { PermissionGrantRepo } from '../db/repositories/permissionGrantRepo'

const protectedTools = new Set(['read', 'write', 'edit', 'bash'])

export type ApprovalPolicyDecision =
  | { outcome: 'allow'; permission?: PermissionDescriptor; grant?: PermissionGrant }
  | { outcome: 'prompt'; permission: PermissionDescriptor }

export class ApprovalPolicy {
  constructor(private readonly repo: PermissionGrantRepo) {}

  protects(toolName: string): boolean {
    return protectedTools.has(toolName)
  }

  async evaluate(
    sessionId: string,
    toolName: string,
    _args: unknown,
  ): Promise<ApprovalPolicyDecision> {
    if (!this.protects(toolName)) return { outcome: 'allow' }

    const permission = this.describe(toolName)
    const grant = (await this.repo.list()).find(
      (candidate) =>
        (candidate.duration === 'always' || candidate.sessionId === sessionId) &&
        matches(candidate.permission, permission),
    )

    return grant
      ? { outcome: 'allow', permission, grant: this.normalizeGrant(grant) }
      : { outcome: 'prompt', permission }
  }

  async grant(
    duration: PermissionGrantDuration,
    sessionId: string,
    requestedPermission: PermissionDescriptor,
  ): Promise<PermissionGrant> {
    const permission = this.describe(requestedPermission.toolName)
    const grants = await this.repo.list()
    const existing = grants.find(
      (candidate) =>
        candidate.duration === duration &&
        candidate.sessionId === (duration === 'session' ? sessionId : undefined) &&
        samePermission(candidate.permission, permission),
    )
    if (existing) return this.normalizeGrant(existing)

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
    const grants = await this.repo.list()
    const unique = new Map<string, PermissionGrant>()

    for (const grant of grants) {
      const key = grantKey(grant)
      if (!unique.has(key)) unique.set(key, this.normalizeGrant(grant))
    }

    return [...unique.values()]
  }

  async revoke(id: string): Promise<void> {
    const grants = await this.repo.list()
    const target = grants.find((grant) => grant.id === id)
    if (!target) return

    const key = grantKey(target)
    for (const grant of grants) {
      if (grantKey(grant) === key) await this.repo.delete(grant.id)
    }
  }

  private describe(toolName: string): PermissionDescriptor {
    return {
      toolName,
      action: 'tool.execute',
      resourceKind: 'tool',
      resource: toolName,
      recursive: false,
      description: `允许内置工具 ${toolName} 自动执行`,
    }
  }

  private normalizeGrant(grant: PermissionGrant): PermissionGrant {
    return { ...grant, permission: this.describe(grant.permission.toolName) }
  }
}

function samePermission(left: PermissionDescriptor, right: PermissionDescriptor): boolean {
  return left.toolName === right.toolName
}

function matches(granted: PermissionDescriptor, requested: PermissionDescriptor): boolean {
  return samePermission(granted, requested)
}

function grantKey(grant: PermissionGrant): string {
  const sessionId = grant.duration === 'session' ? (grant.sessionId ?? null) : null
  return JSON.stringify([grant.duration, sessionId, grant.permission.toolName])
}
