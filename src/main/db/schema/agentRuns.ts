import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { AgentPlan } from '@/shared/agent/agentPlan'
import type { AgentRunStatus } from '@/shared/agent/agentRun'
import type { SubagentAvatar } from '@/shared/agent/delegateTask'
import type { ToolCall, ToolResult } from '@/shared/tool/tool'
import { conversations } from './conversations'

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    avatar: text('avatar').$type<SubagentAvatar>(),
    parentRunId: text('parent_run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    rootRunId: text('root_run_id'),
    depth: integer('depth').notNull().default(0),
    scheduledTaskId: text('scheduled_task_id'),
    status: text('status').$type<AgentRunStatus>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    error: text('error'),
    result: text('result'),
    plan: text('plan', { mode: 'json' }).$type<AgentPlan>(),
    toolCalls: text('tool_calls', { mode: 'json' }).$type<ToolCall[]>().notNull().default([]),
    toolResults: text('tool_results', { mode: 'json' }).$type<ToolResult[]>().notNull().default([]),
    artifactIds: text('artifact_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  },
  (table) => [
    index('agent_runs_session_created_at_idx').on(table.sessionId, table.createdAt),
    index('agent_runs_parent_idx').on(table.parentRunId),
    index('agent_runs_root_idx').on(table.rootRunId),
    index('agent_runs_status_idx').on(table.status),
    index('agent_runs_scheduled_task_idx').on(table.scheduledTaskId),
  ],
)

export type AgentRunRow = typeof agentRuns.$inferSelect
export type NewAgentRunRow = typeof agentRuns.$inferInsert
