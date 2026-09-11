import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { AgentRunStatus } from '@/shared/agent/agentRun'
import type { ToolCall, ToolResult } from '@/shared/tool/tool'
import { conversations } from './conversations'

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    status: text('status').$type<AgentRunStatus>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    error: text('error'),
    toolCalls: text('tool_calls', { mode: 'json' }).$type<ToolCall[]>().notNull().default([]),
    toolResults: text('tool_results', { mode: 'json' }).$type<ToolResult[]>().notNull().default([]),
  },
  (table) => [
    index('agent_runs_session_created_at_idx').on(table.sessionId, table.createdAt),
    index('agent_runs_status_idx').on(table.status),
  ],
)

export type AgentRunRow = typeof agentRuns.$inferSelect
export type NewAgentRunRow = typeof agentRuns.$inferInsert
