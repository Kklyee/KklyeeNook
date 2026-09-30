import { and, desc, eq, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { AgentMemory, AgentMemoryScope } from '@/shared/memory/agentMemory'
import type { Database } from '../client'
import { memories, type MemoryRow } from '../schema/memories'

export interface AgentMemoryCreateInput {
  scope: AgentMemoryScope
  content: string
  workspaceId?: string
}

export interface AgentMemoryRepo {
  list(workspaceId?: string): Promise<AgentMemory[]>
  create(input: AgentMemoryCreateInput): Promise<AgentMemory>
  update(id: string, content: string): Promise<AgentMemory | undefined>
  delete(id: string): Promise<void>
}

export class DrizzleAgentMemoryRepo implements AgentMemoryRepo {
  constructor(private readonly db: Database) {}

  async list(workspaceId?: string): Promise<AgentMemory[]> {
    const canonicalWorkspaceId = workspaceId
    const condition = canonicalWorkspaceId
      ? or(
          eq(memories.scope, 'global'),
          and(eq(memories.scope, 'workspace'), eq(memories.workspaceId, canonicalWorkspaceId)),
        )
      : eq(memories.scope, 'global')
    const rows = await this.db
      .select()
      .from(memories)
      .where(condition)
      .orderBy(desc(memories.updatedAt))

    return rows.map(toAgentMemory)
  }

  async create(input: AgentMemoryCreateInput): Promise<AgentMemory> {
    const content = normalizeContent(input.content)
    const workspaceId = resolveWorkspaceId(input.scope, input.workspaceId)
    const now = Date.now()
    const row: MemoryRow = {
      id: randomUUID(),
      scope: input.scope,
      workspaceId,
      workspacePath: null,
      content,
      createdAt: now,
      updatedAt: now,
    }
    await this.db.insert(memories).values(row)
    return toAgentMemory(row)
  }

  async update(id: string, content: string): Promise<AgentMemory | undefined> {
    const normalizedContent = normalizeContent(content)
    const existing = await this.db.select().from(memories).where(eq(memories.id, id)).limit(1)
    const row = existing[0]
    if (!row) return undefined

    const updatedAt = Date.now()
    await this.db
      .update(memories)
      .set({ content: normalizedContent, updatedAt })
      .where(eq(memories.id, id))
    return toAgentMemory({ ...row, content: normalizedContent, updatedAt })
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(memories).where(eq(memories.id, id))
  }
}

function toAgentMemory(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    scope: row.scope,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizeContent(content: string): string {
  const normalized = content.trim()
  if (!normalized) throw new Error('Memory content is required')
  return normalized
}

function resolveWorkspaceId(scope: AgentMemoryScope, workspaceId?: string): string | null {
  if (scope === 'global') return null
  if (!workspaceId?.trim()) throw new Error('Workspace memory requires a workspace ID')
  return workspaceId
}
