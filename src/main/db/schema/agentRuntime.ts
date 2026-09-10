import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { conversations } from './conversations'

export const agentRuntimeStates = sqliteTable('agent_runtime_states', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),

  runtimeKind: text('runtime_kind').notNull(),
  resumeRef: text('resume_ref').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
