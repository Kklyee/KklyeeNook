import { asc, eq } from 'drizzle-orm'

import type { PermissionGrant } from '@/shared/approval/approvalTypes'
import type { Database } from '../client'
import { permissionGrants, type PermissionGrantRow } from '../schema/permissionGrants'

export interface PermissionGrantRepo {
  list(): Promise<PermissionGrant[]>
  save(grant: PermissionGrant): Promise<void>
  delete(id: string): Promise<void>
}

function toPermissionGrant(row: PermissionGrantRow): PermissionGrant {
  return {
    id: row.id,
    effect: row.effect,
    duration: row.duration,
    sessionId: row.sessionId ?? undefined,
    permission: {
      toolName: row.toolName,
      action: row.action,
      resourceKind: row.resourceKind,
      resource: row.resource,
      recursive: row.recursive,
      description: row.description,
    },
    createdAt: row.createdAt,
  }
}

export class DrizzlePermissionGrantRepo implements PermissionGrantRepo {
  constructor(private readonly db: Database) {}

  async list(): Promise<PermissionGrant[]> {
    const rows = await this.db
      .select()
      .from(permissionGrants)
      .orderBy(asc(permissionGrants.createdAt))

    return rows.map(toPermissionGrant)
  }

  async save(grant: PermissionGrant): Promise<void> {
    await this.db
      .insert(permissionGrants)
      .values({
        id: grant.id,
        effect: grant.effect,
        duration: grant.duration,
        sessionId: grant.sessionId,
        toolName: grant.permission.toolName,
        action: grant.permission.action,
        resourceKind: grant.permission.resourceKind,
        resource: grant.permission.resource,
        recursive: grant.permission.recursive,
        description: grant.permission.description,
        createdAt: grant.createdAt,
      })
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(permissionGrants).where(eq(permissionGrants.id, id))
  }
}
