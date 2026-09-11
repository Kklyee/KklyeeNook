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
    event: parseAgentEvent(row.eventJson),
  }
}

function parseAgentEvent(json: string): AgentEvent {
  const event = JSON.parse(json) as Record<string, unknown>

  if (event.type === 'tool_started' && typeof event.toolCallId === 'string') {
    return {
      type: 'tool_started',
      call: { id: event.toolCallId, toolName: String(event.tool), args: event.args },
    }
  }

  if (event.type === 'tool_finished' && typeof event.toolCallId === 'string') {
    return {
      type: 'tool_finished',
      result: {
        toolCallId: event.toolCallId,
        toolName: String(event.tool),
        output: event.result,
        success: event.success === true,
      },
    }
  }

  if (event.type === 'approval_required' && typeof event.toolCallId === 'string') {
    return {
      type: 'approval_required',
      approvalId: String(event.approvalId),
      call: { id: event.toolCallId, toolName: String(event.tool), args: event.args },
    }
  }

  return event as unknown as AgentEvent
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
