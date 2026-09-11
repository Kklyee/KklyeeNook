import { asc, eq } from 'drizzle-orm'

import type { AgentMessageProjection } from '@/shared/agent/agentMessage'
import type { Database } from '../client'
import { agentMessages } from '../schema/conversations'

export interface AgentMessageRepo {
  findBySessionId(sessionId: string): Promise<AgentMessageProjection[]>
  save(message: AgentMessageProjection): Promise<void>
  replaceBySession(sessionId: string, messages: readonly AgentMessageProjection[]): Promise<void>
}

export class DrizzleAgentMessageRepo implements AgentMessageRepo {
  constructor(private readonly db: Database) {}

  async findBySessionId(sessionId: string): Promise<AgentMessageProjection[]> {
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(asc(agentMessages.createdAt))

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      parentId: row.parentId,
      role: row.role,
      createdAt: row.createdAt,
      payload: JSON.parse(row.payloadJson),
    }))
  }

  async save(message: AgentMessageProjection): Promise<void> {
    await this.db
      .insert(agentMessages)
      .values({
        id: message.id,
        sessionId: message.sessionId,
        parentId: message.parentId,
        role: message.role,
        createdAt: message.createdAt,
        payloadJson: JSON.stringify(message.payload),
        runConfigJson: null,
      })

      .onConflictDoUpdate({
        target: [agentMessages.sessionId, agentMessages.id],
        set: {
          parentId: message.parentId,
          role: message.role,
          createdAt: message.createdAt,
          payloadJson: JSON.stringify(message.payload),
          runConfigJson: null,
        },
      })
  }

  async replaceBySession(
    sessionId: string,
    messages: readonly AgentMessageProjection[],
  ): Promise<void> {
    await this.db.delete(agentMessages).where(eq(agentMessages.sessionId, sessionId))
    for (const message of messages) await this.save(message)
  }
}
