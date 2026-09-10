import { eq } from 'drizzle-orm'

import type { Database } from '../client'

import { agentRuntimeStates } from '../schema/agentRuntime'

export interface AgentRuntimeStateRecord {
  sessionId: string
  runtimeKind: string
  resumeRef: string
  updatedAt: number
}

export interface AgentRuntimeStateRepo {
  findBySessionId(sessionId: string): Promise<AgentRuntimeStateRecord | undefined>
  save(state: AgentRuntimeStateRecord): Promise<void>
  delete(sessionId: string): Promise<void>
}

export class DrizzleAgentRuntimeStateRepo implements AgentRuntimeStateRepo {
  constructor(private readonly db: Database) {}

  async findBySessionId(sessionId: string): Promise<AgentRuntimeStateRecord | undefined> {
    const rows = await this.db
      .select()
      .from(agentRuntimeStates)
      .where(eq(agentRuntimeStates.sessionId, sessionId))
      .limit(1)

    return rows[0]
  }

  async save(state: AgentRuntimeStateRecord): Promise<void> {
    await this.db
      .insert(agentRuntimeStates)
      .values(state)
      .onConflictDoUpdate({
        target: agentRuntimeStates.sessionId,
        set: {
          runtimeKind: state.runtimeKind,
          resumeRef: state.resumeRef,
          updatedAt: state.updatedAt,
        },
      })
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.delete(agentRuntimeStates).where(eq(agentRuntimeStates.sessionId, sessionId))
  }
}
