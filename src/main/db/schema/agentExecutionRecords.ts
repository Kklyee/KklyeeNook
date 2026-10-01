import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { agentRuns } from './agentRuns'
import { conversations } from './conversations'

export const agentExecutionRecords = sqliteTable(
  'agent_execution_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    stepId: text('step_id'),
    timestamp: integer('timestamp').notNull(),
    eventType: text('event_type').notNull(),
    eventJson: text('event_json').notNull(),
  },
  (table) => [
    uniqueIndex('agent_execution_records_run_seq_idx').on(table.runId, table.seq),
    index('agent_execution_records_run_step_seq_idx').on(table.runId, table.stepId, table.seq),
    index('agent_execution_records_session_idx').on(table.sessionId),
  ],
)

export type AgentExecutionRecordRow = typeof agentExecutionRecords.$inferSelect
