import { desc, eq } from 'drizzle-orm'

import type { Database } from '../client'

import { conversations } from '../schema/conversations'

export interface AgentSessionRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface AgentSessionRepo {
  findAll(): Promise<AgentSessionRecord[]>
  findById(id: string): Promise<AgentSessionRecord | undefined>
  save(session: AgentSessionRecord): Promise<void>
  delete(id: string): Promise<void>
}

export class DrizzleAgentSessionRepo implements AgentSessionRepo {
  constructor(private readonly db: Database) {}

  async findAll(): Promise<AgentSessionRecord[]> {
    return this.db.select().from(conversations).orderBy(desc(conversations.updatedAt))
  }

  async findById(id: string): Promise<AgentSessionRecord | undefined> {
    const rows = await this.db.select().from(conversations).where(eq(conversations.id, id)).limit(1)

    return rows[0]
  }

  async save(session: AgentSessionRecord): Promise<void> {
    await this.db
      .insert(conversations)
      .values(session)
      .onConflictDoUpdate({
        target: conversations.id,
        set: { title: session.title, updatedAt: session.updatedAt },
      })
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(conversations).where(eq(conversations.id, id))
  }
}
