import { asc, eq } from 'drizzle-orm'

import type { AgentMessageSnapshot } from '@/shared/chat/chatHistory'
import type { Database } from '../client'
import { agentMessages } from '../schema/conversations'

export interface AgentMessageRepo {
  findBySessionId(sessionId: string): Promise<AgentMessageSnapshot[]>
  save(message: AgentMessageSnapshot): Promise<void>
}

export class DrizzleAgentMessageRepo implements AgentMessageRepo {
  constructor(private readonly db: Database) {}

  async findBySessionId(sessionId: string): Promise<AgentMessageSnapshot[]> {
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
      runConfig: row.runConfigJson ? JSON.parse(row.runConfigJson) : undefined,
    }))
  }

  async save(message: AgentMessageSnapshot): Promise<void> {
    await this.db
      .insert(agentMessages)
      .values({
        id: message.id,
        sessionId: message.sessionId,
        parentId: message.parentId,
        role: message.role,
        createdAt: message.createdAt,
        payloadJson: JSON.stringify(message.payload),
        runConfigJson: message.runConfig === undefined ? null : JSON.stringify(message.runConfig),
      })

      .onConflictDoUpdate({
        target: [agentMessages.sessionId, agentMessages.id],
        set: {
          parentId: message.parentId,
          role: message.role,
          createdAt: message.createdAt,
          payloadJson: JSON.stringify(message.payload),
          runConfigJson: message.runConfig === undefined ? null : JSON.stringify(message.runConfig),
        },
      })
  }
}
