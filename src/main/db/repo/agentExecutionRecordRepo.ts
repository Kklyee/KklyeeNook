import { asc, eq } from 'drizzle-orm'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentEventEnvelope } from '@/main/agent/agentEventEnvelope'
import type { Database } from '../client'
import {
  agentExecutionRecords,
  type AgentExecutionRecordRow,
} from '../schema/agentExecutionRecords'

export interface AgentExecutionRecordRepo {
  append(envelope: AgentEventEnvelope): Promise<void>
  findByRunId(runId: string): Promise<AgentExecutionRecord[]>
}

function toExecutionRecord(row: AgentExecutionRecordRow): AgentExecutionRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    timestamp: row.timestamp,
    event: JSON.parse(row.eventJson) as AgentEvent,
  }
}

export class DrizzleAgentExecutionRecordRepo implements AgentExecutionRecordRepo {
  constructor(private readonly db: Database) {}

  async append(envelope: AgentEventEnvelope): Promise<void> {
    await this.db.insert(agentExecutionRecords).values({
      sessionId: envelope.sessionId,
      runId: envelope.runId,
      timestamp: envelope.timestamp,
      eventType: envelope.event.type,
      eventJson: JSON.stringify(envelope.event),
    })
  }

  async findByRunId(runId: string): Promise<AgentExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(agentExecutionRecords)
      .where(eq(agentExecutionRecords.runId, runId))
      .orderBy(asc(agentExecutionRecords.timestamp), asc(agentExecutionRecords.id))

    return rows.map(toExecutionRecord)
  }
}
