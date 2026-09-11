import { asc, desc, eq, inArray } from 'drizzle-orm'

import type { AgentRun } from '@/shared/agent/agentRun'
import type { Database } from '../client'
import { agentRuns, type AgentRunRow } from '../schema/agentRuns'

export interface AgentRunRepo {
  findAll(): Promise<AgentRun[]>
  findBySessionId(sessionId: string): Promise<AgentRun[]>
  save(run: AgentRun): Promise<void>
  markActiveAsInterrupted(interruptedAt: number): Promise<void>
}

function toAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    error: row.error ?? undefined,
    toolCalls: row.toolCalls,
    toolResults: row.toolResults,
  }
}

export class DrizzleAgentRunRepo implements AgentRunRepo {
  constructor(private readonly db: Database) {}

  async findAll(): Promise<AgentRun[]> {
    const rows = await this.db.select().from(agentRuns).orderBy(asc(agentRuns.createdAt))
    return rows.map(toAgentRun)
  }

  async findBySessionId(sessionId: string): Promise<AgentRun[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.sessionId, sessionId))
      .orderBy(desc(agentRuns.createdAt))

    return rows.map(toAgentRun)
  }

  async save(run: AgentRun): Promise<void> {
    await this.db
      .insert(agentRuns)
      .values({
        id: run.id,
        sessionId: run.sessionId,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        error: run.error,
        toolCalls: run.toolCalls,
        toolResults: run.toolResults,
      })
      .onConflictDoUpdate({
        target: agentRuns.id,
        set: {
          status: run.status,
          updatedAt: run.updatedAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          error: run.error,
          toolCalls: run.toolCalls,
          toolResults: run.toolResults,
        },
      })
  }

  async markActiveAsInterrupted(interruptedAt: number): Promise<void> {
    await this.db
      .update(agentRuns)
      .set({ status: 'interrupted', updatedAt: interruptedAt, completedAt: interruptedAt })
      .where(inArray(agentRuns.status, ['running', 'waiting']))
  }
}
