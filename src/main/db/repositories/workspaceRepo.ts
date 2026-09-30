import { desc, eq } from 'drizzle-orm'
import type { Workspace } from '@/shared/workspace/workspace'
import type { Database } from '../client'
import { workspaces } from '../schema/workspaces'

export interface WorkspaceRepo {
  list(): Promise<Workspace[]>
  get(id: string): Promise<Workspace | undefined>
  save(workspace: Workspace): Promise<void>
}

function toWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  return {
    ...row,
    rootPath: row.rootPath ?? undefined,
    lastKnownPath: row.lastKnownPath ?? undefined,
    fsDevice: row.fsDevice ?? undefined,
    fsInode: row.fsInode ?? undefined,
    lastOpenedAt: row.lastOpenedAt ?? undefined,
  }
}

export class DrizzleWorkspaceRepo implements WorkspaceRepo {
  constructor(private readonly db: Database) {}

  async list(): Promise<Workspace[]> {
    return (await this.db.select().from(workspaces).orderBy(desc(workspaces.updatedAt))).map(toWorkspace)
  }

  async get(id: string): Promise<Workspace | undefined> {
    const [row] = await this.db.select().from(workspaces).where(eq(workspaces.id, id))
    return row ? toWorkspace(row) : undefined
  }

  async save(workspace: Workspace): Promise<void> {
    const row = { ...workspace, rootPath: workspace.rootPath ?? null, lastKnownPath: workspace.lastKnownPath ?? null }
    await this.db.insert(workspaces).values(row).onConflictDoUpdate({ target: workspaces.id, set: row })
  }
}
